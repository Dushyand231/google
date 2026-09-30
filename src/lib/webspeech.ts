/**
 * Web Speech API recogniser (browser builds only).
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE PRODUCT
 * ----------------------------------------------
 * On-device IndicConformer (see voice.ts) is the real answer: it works with no
 * connectivity and patient audio never leaves the handset. This module exists so
 * the dictation *flow* can be exercised today, in a browser, without waiting for
 * a native build.
 *
 * Two things follow from that, and the UI must show both:
 *
 *   1. Audio is transcribed by the browser vendor's cloud service. There is no
 *      local model behind it. It needs a network connection.
 *   2. Therefore it must never be used for real patient data. `WebAsrWarning`
 *      is rendered on every screen that offers it for exactly this reason.
 *
 * Chrome is the only engine that implements this in a usable form. Safari has
 * webkitSpeechRecognition with a different, less reliable shape; Firefox has
 * nothing. We feature-detect and report honestly rather than half-supporting it.
 *
 * This is a test harness. The clinical path is on-device.
 */

import { capabilities, type AppLocale, type AsrAvailability } from './voice';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}
interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type SpeechCapableWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as SpeechCapableWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Availability for the browser build.
 *
 * Distinct from on-device availability, and the reason string is intentionally
 * explicit: a web user must never be told dictation is private.
 */
export function webAsrAvailability(locale: AppLocale): AsrAvailability {
  if (!getCtor()) {
    return {
      kind: 'unavailable',
      reason: 'unsupported-platform',
      detail:
        'This browser has no Web Speech API. Use Chrome for browser dictation; the on-device model works in the mobile app.',
    };
  }
  void capabilities(locale);
  return { kind: 'ready' };
}

/** True when dictation in this build sends audio off the device. */
export function isCloudBacked(locale: AppLocale): boolean {
  return webAsrAvailability(locale).kind === 'ready';
}

export interface WebTranscript {
  text: string;
  /** Always false, matching the on-device contract: nothing is auto-verified. */
  verified: false;
  engine: 'web-cloud';
}


export interface WebRecognizer {
  start(onInterim?: (text: string) => void): void;
  stop(): Promise<WebTranscript>;
  abort(): void;
}

/**
 * Hold-to-talk recogniser.
 *
 * Interim results are surfaced as they arrive so the health worker can see the
 * machine is still listening; only the final result is returned, because
 * interim strings are frequently truncated mid-word and feeding those into the
 * parser would produce confident nonsense.
 */
export function createWebRecognizer(locale: AppLocale): WebRecognizer {
  const Ctor = getCtor();
  if (!Ctor) throw new Error('Web Speech API unavailable in this browser');

  const rec = new Ctor();
  rec.lang = locale === 'en' ? 'en-US' : `${locale}-IN`;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = '';
  let settled: ((t: WebTranscript) => void) | null = null;
  let failed: ((m: string) => void) | null = null;

  rec.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) finalText += text;
    }
  };
  rec.onerror = (event) => {
    failed?.(describeError(event.error));
  };
  rec.onend = () => {
    if (settled) {
      const done = settled;
      settled = null;
      failed = null;
      done({ text: finalText.trim(), verified: false, engine: 'web-cloud' });
    }
  };

  return {
    start(onInterim) {
      finalText = '';
      if (onInterim) {
        rec.onresult = (event) => {
          let combined = '';
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const t = event.results[i][0]?.transcript ?? '';
            if (event.results[i].isFinal) combined += t;
            else interim += t;
          }
          onInterim(combined + interim);
        };
      }
      rec.start();
    },
    stop() {
      return new Promise<WebTranscript>((resolve, reject) => {
        settled = resolve;
        failed = (message) => reject(new Error(message));
        rec.stop();
      });
    },
    abort() {
      settled = null;
      failed = null;
      rec.abort();
    },
  };
}

/**
 * Chrome reports these as opaque codes. The two that matter here are
 * 'not-allowed' (permission denied) and 'network' (the cloud service
 * unreachable) -- the network one is expected offline and must not read as
 * "check your microphone".
 */
function describeError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission denied. Allow it in the browser address bar.';
    case 'no-speech':
      return 'No speech detected. Hold the button and speak while recording.';
    case 'network':
      return 'Browser dictation needs a network connection. It uses the browser vendor cloud, not an on-device model.';
    case 'audio-capture':
      return 'No microphone found.';
    default:
      return `Speech recognition failed: ${code}`;
  }
}
