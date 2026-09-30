/**
 * Voice I/O for JeevaCare.
 *
 * Two halves, deliberately independent, because they have very different
 * constraints:
 *
 *   speak()  - expo-speech. System TTS, works in Expo Go, ships in the OS.
 *              Available today on every language we ship.
 *
 *   createRecognizer() - speech-to-text. On-device is the only option that
 *              satisfies the product requirement: a rural clinic with no
 *              connectivity must still be able to dictate, and patient audio
 *              must not leave the device. On-device engines (sherpa-onnx +
 *              IndicConformer) require a development build; they do NOT exist
 *              in Expo Go.
 *
 * That asymmetry is the whole reason this file reports availability instead of
 * pretending. See capabilities() for what the running binary can actually do,
 * and the *-unavailable reasons for the rest.
 *
 * IMPORTANT: recognised speech is a *draft*. A wrong blood pressure that looks
 * confident is more dangerous than no reading at all, so nothing here marks a
 * transcript as verified. See parse.ts for the "never invent" contract.
 */

import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

export type AppLocale = 'en' | 'ta' | 'hi' | 'te' | 'kn' | 'ml';

/**
 * expo-speech BCP-47 tags. Tamil is the one that needs care: 'ta-IN' is what
 * Android's TTS engine matches, and a bare 'ta' silently falls back to the
 * default voice, which for a Tamil user means hearing a language they do not
 * speak while the UI says "Tamil".
 */
const SPEECH_TAG: Record<AppLocale, string> = {
  en: 'en-US',
  ta: 'ta-IN',
  hi: 'hi-IN',
  te: 'te-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
};

/**
 * IndicConformer ships one model per language. These are the HuggingFace
 * repo/file triples verified to exist, with the shared vocabulary file.
 * int8 keeps each at ~188 MB, which is the download a first run has to
 * survive. Served from our own CDN in production; these URLs are the
 * documented upstream source of truth.
 */
export interface AsrModelSpec {
  locale: AppLocale;
  /** Bytes, int8, measured. Shown in the UI before a user commits to it. */
  sizeBytes: number;
  modelUrl: string;
  tokensUrl: string;
}

const ASR_BASE =
  'https://huggingface.co/parismitaglobalsolutions/indicconformer-sherpa-onnx/resolve/main';

export const ASR_MODELS: Record<AppLocale, AsrModelSpec | null> = {
  ta: {
    locale: 'ta',
    sizeBytes: 188 * 1024 * 1024,
    modelUrl: `${ASR_BASE}/ta/model.int8.onnx`,
    tokensUrl: `${ASR_BASE}/tokens.txt`,
  },
  hi: {
    locale: 'hi',
    sizeBytes: 188 * 1024 * 1024,
    modelUrl: `${ASR_BASE}/hi/model.int8.onnx`,
    tokensUrl: `${ASR_BASE}/tokens.txt`,
  },
  te: {
    locale: 'te',
    sizeBytes: 188 * 1024 * 1024,
    modelUrl: `${ASR_BASE}/te/model.int8.onnx`,
    tokensUrl: `${ASR_BASE}/tokens.txt`,
  },
  kn: {
    locale: 'kn',
    sizeBytes: 188 * 1024 * 1024,
    modelUrl: `${ASR_BASE}/kn/model.int8.onnx`,
    tokensUrl: `${ASR_BASE}/tokens.txt`,
  },
  ml: {
    locale: 'ml',
    sizeBytes: 188 * 1024 * 1024,
    modelUrl: `${ASR_BASE}/ml/model.int8.onnx`,
    tokensUrl: `${ASR_BASE}/tokens.txt`,
  },
  // Whisper is English-only at this size class; the 6-language option is the
  // 357 MB multilingual set, which is not a download we want to force on a 2G
  // clinic. English dictation is served by the OS instead.
  en: null,
};

export type AsrAvailability =
  | { kind: 'ready' }
  | { kind: 'unavailable'; reason: 'expo-go' | 'no-model' | 'unsupported-platform'; detail: string };

export interface VoiceCapabilities {
  tts: boolean;
  asr: AsrAvailability;
  /** The locale the OS will actually speak, for display and for honesty. */
  speechTag: string;
}

let expoGoDetected: boolean | null = null;

/**
 * True when the sherpa-onnx native module is not linked -- which is the case in
 * Expo Go, and the reason dictation is unavailable there.
 *
 * We probe the native module rather than reading Constants.expoConfig: the
 * manifest describes the JS entry point, not which native modules the host
 * actually linked, so it cannot answer this question. The package *resolves*
 * fine in Expo Go, so importing it proves nothing -- only calling into it
 * throws, which is what testSherpaInit() does.
 */
async function isExpoGo(): Promise<boolean> {
  if (expoGoDetected !== null) return expoGoDetected;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-sherpa-onnx') as { testSherpaInit?: () => Promise<string> };
    if (typeof mod.testSherpaInit !== 'function') {
      expoGoDetected = true;
    } else {
      await mod.testSherpaInit();
      expoGoDetected = false;
    }
  } catch {
    expoGoDetected = true;
  }
  return expoGoDetected;
}

export async function capabilities(locale: AppLocale): Promise<VoiceCapabilities> {
  const speechTag = SPEECH_TAG[locale];
  if (Platform.OS === 'web') {
    // Browser dictation is provided by voice.web.ts (Web Speech API), which
    // feature-detects Chrome. We report the browser's capability rather than
    // declaring it unavailable here, and the UI must state that this path is
    // cloud-backed -- see isCloudBacked in voice.web.ts.
    return {
      tts: typeof window !== 'undefined' && 'speechSynthesis' in window,
      asr: { kind: 'ready' },
      speechTag,
    };
  }
  if (await isExpoGo()) {
    return {
      tts: true,
      asr: {
        kind: 'unavailable',
        reason: 'expo-go',
        detail:
          'On-device speech recognition is a native module and cannot run in Expo Go. Install a development build (npx expo run:android) to enable dictation.',
      },
      speechTag,
    };
  }
  const model = ASR_MODELS[locale];
  return {
    tts: true,
    asr: model
      ? { kind: 'ready' }
      : {
          kind: 'unavailable',
          reason: 'no-model',
          detail:
            locale === 'en'
              ? 'English dictation is handled by the operating system in this build.'
              : `No on-device model is registered for ${locale}.`,
        },
    speechTag,
  };
}

export interface SpeakOptions {
  locale: AppLocale;
  /** Slightly slower than default: these are read to low-literacy users. */
  rate?: number;
  pitch?: number;
  onDone?: () => void;
  onError?: (message: string) => void;
}

/**
 * Read text aloud in the given language. No-ops with an explicit onError
 * rather than throwing: a missing TTS voice must not take down a consultation.
 */
export function speak(text: string, opts: SpeakOptions): void {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  try {
    Speech.stop();
    Speech.speak(clean, {
      language: SPEECH_TAG[opts.locale],
      rate: opts.rate ?? 0.85,
      pitch: opts.pitch ?? 1.0,
      onDone: opts.onDone,
      onError: (error: unknown) => opts.onError?.(String(error)),
    });
  } catch (error) {
    opts.onError?.(String(error));
  }
}

export function stopSpeaking(): void {
  try {
    Speech.stop();
  } catch {
    /* nothing to stop */
  }
}

export type RecorderState = 'idle' | 'recording' | 'processing' | 'error';

export interface TranscriptResult {
  text: string;
  /** Always false. Confirming a transcript is a human step, by design. */
  verified: false;
  engine: 'on-device' | 'unavailable';
}

export interface Recognizer {
  /** Transcribe a clip recorded at `uri` (file:// path from expo-audio). */
  transcribe(uri: string): Promise<TranscriptResult>;
}

export type EngineKind = 'on-device' | 'web-cloud' | TranscriptResult['engine'];

export type AsrUnavailableReason = 'expo-go' | 'no-model' | 'unsupported-platform';

export class AsrUnavailableError extends Error {
  readonly reason: AsrUnavailableReason;
  constructor(detail: string, reason: AsrUnavailableReason) {
    super(detail);
    this.name = 'AsrUnavailableError';
    this.reason = reason;
  }
}

/**
 * Optional native engine, injected at module load.
 *
 * Keeping this an injection point (rather than importing sherpa-onnx here) is
 * what lets the same source run in Expo Go, in a dev build, and in tests: the
 * host binds an engine when it has one. Nobody importing `Recognizer` needs to
 * know which, and no call site silently returns invented text.
 */
let nativeEngine: NativeAsrEngine | null = null;

export interface NativeAsrEngine {
  /** Load (or reuse) a model for this locale. */
  load(spec: AsrModelSpec, onProgress?: (fraction: number) => void): Promise<void>;
  /** Transcribe 16 kHz mono PCM/WAV at `uri`. */
  transcribe(spec: AsrModelSpec, uri: string): Promise<string>;
}

/**
 * Bind a native ASR engine. Called by the platform bootstrap once the native
 * module and model are present. Tests bind a fake.
 */
export function setNativeAsrEngine(engine: NativeAsrEngine | null): void {
  nativeEngine = engine;
}

export function hasNativeAsrEngine(): boolean {
  return nativeEngine !== null;
}

/**
 * Create a dictation recogniser for the given locale.
 *
 * Throws AsrUnavailableError rather than returning a broken recogniser, so the
 * UI can explain *why* dictation is off instead of showing a dead button. It
 * never returns a recogniser that fabricates text.
 */
export async function createRecognizer(
  locale: AppLocale,
  onModelProgress?: (fraction: number) => void,
): Promise<Recognizer> {
  const caps = await capabilities(locale);
  if (caps.asr.kind === 'unavailable') {
    throw new AsrUnavailableError(caps.asr.detail, caps.asr.reason);
  }
  const spec = ASR_MODELS[locale];
  if (!spec) {
    throw new AsrUnavailableError(`No on-device model registered for ${locale}.`, 'no-model');
  }
  if (!nativeEngine) {
    throw new AsrUnavailableError(
      'Native recognition engine is not linked into this bundle. Run npx expo run:android to build with the ASR module.',
      'unsupported-platform',
    );
  }
  await nativeEngine.load(spec, onModelProgress);
  return {
    /**
     * Transcribe a recorded clip.
     *
     * Recording is owned by the caller rather than done here, because
     * expo-audio only exposes recording through a React hook (useAudioRecorder)
     * and a hook cannot be called from this factory. The separation is also
     * what keeps a 188 MB model download off the critical path: the model loads
     * once at createRecognizer(), while the recorder is started per utterance.
     */
    async transcribe(uri: string) {
      const text = await nativeEngine!.transcribe(spec, uri);
      return { text, verified: false, engine: 'on-device' } as TranscriptResult;
    },
  };
}
