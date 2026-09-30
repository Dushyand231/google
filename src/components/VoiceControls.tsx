/**
 * Voice controls for the consultation screen.
 *
 * Two components, one rule between them: the microphone never lies. If
 * recognition is unavailable the button is disabled and the *reason* is shown
 * on the surface, not buried in a console warning. A health worker who taps
 * record and gets silence would reasonably conclude their patient spoke too
 * quietly and start repeating themselves; a visible explanation is the
 * difference between a bug report and a wasted visit.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';

import { colors, radius, space, TAP_MIN, type } from './theme';
import {
  AsrUnavailableError,
  capabilities,
  createRecognizer,
  speak,
  stopSpeaking,
  type AppLocale,
  type AsrAvailability,
  type Recognizer,
} from '../lib/voice';
import { createWebRecognizer, webAsrAvailability, type WebRecognizer } from '../lib/webspeech';
import { setNativeAsrEngine } from '../lib/voice';

// Bind the on-device engine exactly once, and only on native. The import is
// static but the module touches native APIs at load, so Expo Go and web are
// excluded before it is evaluated. Everything downstream then goes through
// createRecognizer() and never needs to know which host it is running on.
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../lib/asr.sherpa') as { sherpaAsrEngine: Parameters<typeof setNativeAsrEngine>[0] };
    setNativeAsrEngine(mod.sherpaAsrEngine);
  } catch {
    setNativeAsrEngine(null);
  }
}

export function SpeakButton({
  text,
  locale,
  label,
  testID,
}: {
  text: string;
  locale: AppLocale;
  label: string;
  testID?: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  const disabled = text.trim().length === 0;

  useEffect(() => stopSpeaking, []);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: speaking }}
      disabled={disabled}
      onPress={() => {
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
          return;
        }
        setSpeaking(true);
        speak(text, {
          locale,
          onDone: () => setSpeaking(false),
          onError: () => setSpeaking(false),
        });
      }}
      style={({ pressed }) => [
        styles.speakBtn,
        disabled && styles.speakBtnDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={styles.speakGlyph}>{speaking ? '■' : '▶'}</Text>
      <Text style={styles.speakText}>{speaking ? '■' : label}</Text>
    </Pressable>
  );
}

export type MicPhase = 'idle' | 'recording' | 'processing' | 'error';

/**
 * Press-and-hold dictation.
 *
 * Hold-to-talk rather than tap-to-start: a consultation is full of short
 * utterances, and a tap toggle makes it ambiguous whether recording is
 * currently on. Holding gives an unambiguous signal, and release is the stop.
 */
export function MicButton({
  locale,
  labelIdle,
  labelListening,
  labelUnavailable,
  labelCloudTitle = 'Test mode: audio leaves this device',
  labelCloudBody = 'Browser dictation is transcribed in the cloud. Use invented patient details only.',
  onTranscript,
  onInterim,
  onStatus,
  testID,
}: {
  locale: AppLocale;
  labelIdle: string;
  labelListening: string;
  labelUnavailable: string;
  /** Shown above the mic whenever the active engine is cloud-backed. */
  labelCloudTitle?: string;
  labelCloudBody?: string;
  onTranscript: (text: string) => void;
  /**
   * Live partial speech. Routing this into the same editable field the final
   * transcript lands in is what lets a worker correct a misheard number *while
   * speaking*, instead of after committing to it.
   */
  onInterim?: (text: string) => void;
  /** Reports the unavailable reason once, so the screen can explain it. */
  onStatus?: (asr: AsrAvailability) => void;
  testID?: string;
}) {
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [interim, setInterim] = useState<string>('');
  // capabilities() is async because it probes the native module, so it cannot
  // be derived during render. `probed` starts as "unknown" rather than
  // "available": assuming availability would paint a live-looking button for
  // one frame on a build that cannot record.
  const [probed, setProbed] = useState<AsrAvailability | null>(null);
  const [override, setOverride] = useState<AsrAvailability | null>(null);
  // A late runtime failure (missing engine, denied mic) overrides the probe,
  // so the button never stays live after dictation has already failed once.
  const asr = override ?? probed;
  const recognizer = useRef<Recognizer | null>(null);
  const web = useRef<WebRecognizer | null>(null);
  const holding = useRef(false);

  // The browser has no file-based path: Web Speech transcribes a live stream,
  // so cloud mode replaces the whole start/stop pair rather than reusing it.
  const isWeb = Platform.OS === 'web';
  const webAvail = isWeb ? webAsrAvailability(locale) : null;
  const effective = isWeb ? (override ?? webAvail!) : asr;

  useEffect(() => {
    let alive = true;
    if (isWeb) return;
    void capabilities(locale).then((caps) => {
      if (alive) setProbed(caps.asr);
    });
    return () => {
      alive = false;
    };
  }, [locale, isWeb]);

  // LOW_QUALITY is the closest preset to what IndicConformer expects (16 kHz
  // mono); the engine resamples anything else.
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);

  // Availability is reported upward via a callback ref rather than an effect
  // dependency: the visit screen passes an inline closure, so depending on it
  // would re-notify on every parent render. Updating a ref in an effect (not
  // during render) keeps this safe and keeps the dependency array honest.
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);
  const onInterimRef = useRef(onInterim);
  useEffect(() => {
    onInterimRef.current = onInterim;
  }, [onInterim]);
  useEffect(() => {
    if (effective) onStatusRef.current?.(effective);
  }, [effective]);

  useEffect(
    () => () => {
      holding.current = false;
      recognizer.current = null;
      web.current?.abort();
      web.current = null;
    },
    [],
  );

  const begin = useCallback(async () => {
    if (holding.current) return;
    holding.current = true;
    setPhase('recording');
    try {
      if (isWeb) {
        const rec = createWebRecognizer(locale);
        rec.start((partial) => {
          setInterim(partial);
          onInterimRef.current?.(partial);
        });
        web.current = rec;
        return;
      }
      // Model load happens here, before the patient starts speaking, so a
      // first-run 188 MB download never sits inside a live consultation.
      const rec = await createRecognizer(locale, (f) => setProgress(f));
      recognizer.current = rec;
      setProgress(null);
      const granted = await requestRecordingPermissionsAsync();
      if (!granted.granted) throw new AsrUnavailableError('Microphone permission denied.', 'unsupported-platform');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      recorder.record();
    } catch (error) {
      holding.current = false;
      setPhase('error');
      if (error instanceof AsrUnavailableError) {
        // A late failure (no engine linked, denied permission) has to be
        // reflected in what the button shows, not just in the phase.
        setOverride({
          kind: 'unavailable',
          reason: error.reason,
          detail: error.message,
        });
      }
    }
  }, [locale, recorder, isWeb]);

  const finish = useCallback(async () => {
    if (!holding.current) return;
    holding.current = false;

    if (isWeb) {
      const rec = web.current;
      web.current = null;
      if (!rec) {
        setPhase('idle');
        return;
      }
      setPhase('processing');
      try {
        const result = await rec.stop();
        setInterim('');
        setPhase('idle');
        if (result.text.trim()) onTranscript(result.text);
      } catch (error) {
        setInterim('');
        setPhase('error');
        setOverride({
          kind: 'unavailable',
          reason: 'unsupported-platform',
          detail: error instanceof Error ? error.message : 'Browser dictation failed.',
        });
      }
      return;
    }

    const rec = recognizer.current;
    const uri = recorder.uri;
    recorder.stop();
    if (!rec || !uri) {
      setPhase('idle');
      return;
    }
    setPhase('processing');
    try {
      const result = await rec.transcribe(uri);
      setPhase('idle');
      if (result.text.trim()) onTranscript(result.text);
    } catch {
      setPhase('error');
    }
  }, [onTranscript, recorder, isWeb]);

  // Unknown capability disables the button: better a briefly dead mic than a
  // live one that throws on first press.
  const unavailable = !effective || effective.kind === 'unavailable';
  const downloading = progress !== null;
  // A cloud-backed path must be visible, not a footnote. Someone could
  // otherwise dictate a real patient in a browser and never learn the audio
  // went to a third party.
  const cloudBacked = isWeb && !unavailable;

  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={unavailable ? labelUnavailable : phase === 'recording' ? labelListening : labelIdle}
        accessibilityState={{ disabled: !!unavailable, busy: phase === 'recording' || phase === 'processing' }}
        disabled={!!unavailable}
        onPressIn={() => void begin()}
        onPressOut={() => void finish()}
        style={({ pressed }) => [
          styles.mic,
          phase === 'recording' && styles.micActive,
          unavailable && styles.micDisabled,
          pressed && !unavailable && styles.pressed,
        ]}
      >
        {phase === 'processing' || downloading ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <Text style={styles.micGlyph}>{phase === 'recording' ? '■' : '●'}</Text>
        )}
        <Text style={styles.micLabel}>
          {downloading
            ? `${labelIdle} ${Math.round((progress ?? 0) * 100)}%`
            : phase === 'recording'
              ? labelListening
              : phase === 'processing'
                ? '…'
                : labelIdle}
        </Text>
      </Pressable>
      {phase === 'recording' && interim ? (
        <Text style={styles.interim} testID="interim-transcript">
          {interim}
        </Text>
      ) : null}
      {cloudBacked ? (
        <View style={styles.warnBox} testID="cloud-asr-warning">
          <Text style={styles.warnTitle}>{labelCloudTitle}</Text>
          <Text style={styles.warnBody}>{labelCloudBody}</Text>
        </View>
      ) : null}
      {effective && effective.kind === 'unavailable' ? (
        <Text style={styles.note}>{effective.detail}</Text>
      ) : null}
      {phase === 'error' && effective?.kind !== 'unavailable' ? (
        <Text style={styles.note}>Could not capture audio. Check microphone permission.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  speakBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    minHeight: TAP_MIN,
    paddingHorizontal: space(2),
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  speakBtnDisabled: { opacity: 0.4 },
  speakGlyph: { color: colors.primary, ...type.label },
  speakText: { color: colors.primary, ...type.label },
  mic: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1),
    minHeight: TAP_MIN + 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  micActive: { backgroundColor: colors.accent },
  micDisabled: { backgroundColor: colors.textMuted, opacity: 0.55 },
  micGlyph: { color: colors.primaryText, ...type.body },
  micLabel: { color: colors.primaryText, ...type.body },
  note: { marginTop: space(1), color: colors.textMuted, ...type.label },
  interim: {
    marginTop: space(1),
    color: colors.textMuted,
    ...type.body,
    fontStyle: 'italic',
  },
  warnBox: {
    marginTop: space(1),
    marginBottom: space(1),
    padding: space(1.25),
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.warnBg,
    gap: space(0.5),
  },
  warnTitle: { color: colors.warn, ...type.label },
  warnBody: { color: colors.text, ...type.label },
  pressed: { opacity: 0.75 },
});
