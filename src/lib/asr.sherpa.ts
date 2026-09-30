/**
 * On-device ASR: sherpa-onnx + AI4Bharat IndicConformer.
 *
 * This is the real clinical path. It runs entirely on the handset, so a rural
 * clinic with no connectivity can still dictate, and patient audio never
 * leaves the device. Contrast src/lib/webspeech.ts, which is a browser-only
 * test harness backed by a vendor cloud.
 *
 * Model layout expected on disk (downloaded on first use, not bundled):
 *
 *   <dir>/model.int8.onnx
 *   <dir>/tokens.txt
 *
 * The upstream IndicConformer export is a hybrid CTC-RNNT NeMo model flattened
 * to a single CTC file, which is why modelType is forced to 'nemo_ctc' rather
 * than left on 'auto': auto-detection here depends on filename conventions that
 * an int8 export does not reliably match, and a wrong guess surfaces as an
 * opaque native error instead of a clear one.
 *
 * int8 costs a little accuracy against fp32 and halves the download. At 188 MB
 * over a clinic's connection that trade is worth making, and the transcript is
 * always shown for confirmation, so a marginal word error is caught by a human
 * before it becomes a record.
 */

import { createSTT, type SttEngine } from 'react-native-sherpa-onnx/stt';
import {
  DocumentDirectoryPath,
  downloadFile,
  exists,
  mkdir,
} from '@dr.pogodin/react-native-fs';

import type { AsrModelSpec, NativeAsrEngine } from './voice';

interface LoadedModel {
  engine: SttEngine;
  spec: AsrModelSpec;
}

/**
 * Cached across locales. Instantiating a CTC recogniser loads ~188 MB into
 * native memory, and a consultation can switch languages; rebuilding on every
 * switch would stutter badly and risk OOM on a low-end device.
 */
let current: LoadedModel | null = null;
let loading: Promise<LoadedModel> | null = null;

function modelDir(locale: string): string {
  // App-private on Android and backed up nowhere, which is what we want for a
  // downloaded model: no PHI, no iCloud-style leakage.
  return `${DocumentDirectoryPath}/asr-models/${locale}`;
}

async function ensureModel(spec: AsrModelSpec, onProgress?: (f: number) => void): Promise<string> {
  const dir = modelDir(spec.locale);
  const modelFile = `${dir}/model.int8.onnx`;
  const tokensFile = `${dir}/tokens.txt`;

  if ((await exists(modelFile)) && (await exists(tokensFile))) {
    onProgress?.(1);
    return dir;
  }

  await mkdir(dir);

  // We deliberately do not stream the 188 MB through the JS bridge: the
  // download's progress callback is native-side and keeps a 2G link responsive
  // instead of blocking the UI thread on chunked base64.
  onProgress?.(0);
  const res = await downloadFile({
    fromUrl: spec.modelUrl,
    toFile: modelFile,
    progressInterval: 250,
    progressDivider: 2,
    progress: ({ bytesWritten, contentLength }) => {
      const total = contentLength || spec.sizeBytes;
      if (total > 0) onProgress?.(Math.min(0.99, bytesWritten / total));
    },
  }).promise;
  if (res.statusCode !== 200) {
    throw new Error(`Model download failed (HTTP ${res.statusCode}). Check connectivity and retry.`);
  }

  // tokens.txt is tiny but mandatory: without it the decoder has no vocabulary
  // and returns empty strings rather than failing loudly.
  const tok = await downloadFile({ fromUrl: spec.tokensUrl, toFile: tokensFile }).promise;
  if (tok.statusCode !== 200) {
    throw new Error(`Vocabulary download failed (HTTP ${tok.statusCode}).`);
  }

  onProgress?.(1);
  return dir;
}

async function load(spec: AsrModelSpec, onProgress?: (f: number) => void): Promise<LoadedModel> {
  if (current && current.spec.locale === spec.locale) return current;

  // Serialise concurrent loads: two callers racing here would each allocate a
  // second 188 MB engine and one would be orphaned in native memory.
  if (loading) await loading.catch(() => undefined);
  if (current && current.spec.locale === spec.locale) return current;

  loading = (async () => {
    const dir = await ensureModel(spec, onProgress);
    const engine = await createSTT({
      modelPath: { type: 'file', path: dir },
      modelType: 'nemo_ctc',
      preferInt8: true,
      // Greedy search: beam search is measurably slower per utterance and, for
      // short clinical phrases, produces no accuracy gain worth the latency.
      decodingMethod: 'greedy_search',
      numThreads: 2,
    } as Parameters<typeof createSTT>[0]);

    if (current) await current.engine.destroy().catch(() => undefined);
    current = { engine, spec };
    return current;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export const sherpaAsrEngine: NativeAsrEngine = {
  async load(spec, onProgress) {
    await load(spec, onProgress);
  },

  async transcribe(spec, uri) {
    const { engine } = await load(spec);
    // expo-audio writes a container the engine may not read directly; the
    // recorded path is normalised to 16 kHz mono WAV by the recorder config,
    // so this is a plain file read with no conversion step.
    const result = await engine.transcribeFile(uri.replace('file://', ''));
    return (result.text ?? '').trim();
  },
};

/** Release native memory. Called when the app backgrounds. */
export async function releaseAsrEngine(): Promise<void> {
  if (current) {
    await current.engine.destroy().catch(() => undefined);
    current = null;
  }
}
