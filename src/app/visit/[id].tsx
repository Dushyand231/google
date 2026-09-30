/**
 * Voice visit.
 *
 * The screen has exactly one job: take a messy spoken sentence and turn it into
 * a structured record the health worker has actively agreed to. It never saves
 * straight from speech. Anything the parser was unsure about is surfaced as a
 * question rather than a silent default, because a confidently wrong blood
 * pressure is worse than an unrecorded one.
 *
 * Dictation comes from MicButton, which reports whether on-device recognition
 * is actually available rather than showing a dead button. The parser, the
 * confirmation gate and the sync path are identical whether the transcript
 * arrived by voice or by keyboard, so the worker is never blocked: when
 * recognition is unavailable the reason is stated and typing still works.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Banner, Body, Button, Card, Heading, Label, Pill } from '@/components/ui';
import { MicButton } from '@/components/VoiceControls';
import { SymptomGrid, SYMPTOM_ICON } from '@/components/SymptomGrid';
import { colors, radius, space, TAP_MIN, type } from '@/components/theme';
import { useI18n, useT } from '@/i18n';
import { loadSession } from '@/lib/api';
import { getPatient, type Patient } from '@/lib/patients';
import { parseEncounter, type ParsedSymptom, type ParsedVital, type ParseResult, type SymptomCode } from '@/lib/parse';
import { queueEncounter } from '@/lib/encounter';
import type { AsrAvailability } from '@/lib/voice';

export default function VisitScreen() {
  const t = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [transcript, setTranscript] = useState('');
  const [tapped, setTapped] = useState<SymptomCode[]>([]);
  const [asr, setAsr] = useState<AsrAvailability | null>(null);
  const [saved, setSaved] = useState(false);
  const { lang } = useI18n();

  useEffect(() => {
    void (async () => {
      if (typeof id === 'string') setPatient(await getPatient(id));
    })();
  }, [id]);

  // parseEncounter, not parseVitals: the uncertainty list is the whole point
  // of the confirmation gate, and it is only produced by the fuller pass.
  const parsed: ParseResult | null = useMemo(
    () => (transcript.trim() ? parseEncounter(transcript, { lang }) : null),
    [transcript, lang]
  );

  /**
   * Symptoms the worker tapped by hand, merged over anything voice detected.
   *
   * Tapping is not a fallback for a bad transcript -- it is the fast path for a
   * symptom visible in front of them but not spoken aloud, or spoken while the
   * machine misheard it. A tapped symptom therefore wins for its own code, so a
   * deliberate tap is never silently undone by a parse.
   */
  const symptoms: ParsedSymptom[] = useMemo(() => {
    const heard = parsed?.symptoms ?? [];
    const heardCodes = new Set(heard.map((s) => s.code));
    const extra = tapped
      .filter((code) => !heardCodes.has(code))
      .map<ParsedSymptom>((code) => ({
        code,
        icon: SYMPTOM_ICON[code],
        negative: false,
        source: 'tap',
        matchedText: '',
      }));
    return tapped.length > 0 ? [...heard, ...extra] : heard;
  }, [parsed, tapped]);

  const hasContent = (parsed?.vitals.length ?? 0) > 0 || symptoms.length > 0;
  // Anything the parser was unsure about blocks a silent save. The worker has
  // to acknowledge each one, because a confidently wrong number is worse than
  // an unrecorded one.
  const blocked = !hasContent || (parsed?.uncertainties.length ?? 0) > 0;

  async function onSave() {
    if (!patient) return;
    const session = await loadSession();
    if (!session) return;
    // A tap-only visit has no transcript, so the vitals/symptoms are sent
    // without one rather than being blocked on a null parse.
    await queueEncounter({
      patientId: patient.id,
      workerId: session.workerId,
      deviceId: '',
      lang,
      transcript: transcript.trim() ? transcript : null,
      vitals: parsed?.vitals ?? [],
      symptoms,
    });
    setSaved(true);
  }

  if (saved) {
    return (
      <View style={styles.done}>
        <Heading>{t('synced')}</Heading>
        <Body>{t('allSynced')}</Body>
        <Button title={t('done')} onPress={() => router.replace(`/patient/${patient?.id}`)} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {patient ? <Heading>{patient.name}</Heading> : null}

      <MicButton
        locale={lang}
        labelIdle={t('hearing')}
        labelListening={t('listening')}
        labelUnavailable={t('asrUnavailable')}
        onTranscript={(text) => setTranscript((prev) => (prev ? `${prev}\n${text}` : text))}
        onInterim={(partial) => setTranscript(partial)}
        onStatus={setAsr}
        testID="mic"
      />
      {asr?.kind === 'unavailable' ? (
        <Banner tone="info" title={t('typeInsteadTitle')} detail={t('typeInstead')} />
      ) : null}

      <Label>{t('typeInstead')}</Label>
      <TextInput
        value={transcript}
        onChangeText={setTranscript}
        style={styles.input}
        multiline
        placeholder={t('hearing')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('typeInstead')}
        testID="transcript"
      />

      <Label>{t('symptoms')}</Label>
      <SymptomGrid
        selected={tapped}
        onToggle={(code) =>
          setTapped((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
        }
        labelOf={(k) => t(k)}
      />

      {parsed ? (
        <>
          <Heading>{t('extracted')}</Heading>
          {parsed.vitals.length === 0 ? (
            <Card>
              <Body muted>{t('noVitals')}</Body>
            </Card>
          ) : (
            parsed.vitals.map((v) => <VitalRow key={v.kind} vital={v} />)
          )}

          {parsed.unmatchedNumbers.length > 0 ? (
            <Banner
              tone="warn"
              title={t('voiceUncertain')}
              detail={`${t('unmatchedNumbers')}: ${parsed.unmatchedNumbers.join(', ')}`}
            />
          ) : null}

          {parsed.uncertainties.length > 0 ? (
            <Card>
              <Heading>{t('didYouSay')}</Heading>
              {parsed.uncertainties.map((u, i) => (
                <View key={`${u.reason}-${i}`} style={styles.uncertainty}>
                  <Text style={styles.uncertaintyReason}>{UNCERTAINTY_LABEL[u.reason]}</Text>
                  <Body muted>&ldquo;{u.excerpt}&rdquo;</Body>
                </View>
              ))}
            </Card>
          ) : null}

          {symptoms.length > 0 ? (
            <Card>
              <Heading>{t('symptoms')}</Heading>
              {symptoms.map((s) => (
                <View key={s.code} style={styles.uncertainty}>
                  <Text style={styles.uncertaintyReason}>
                    {s.negative ? '✗' : '✓'} {s.code}
                    {s.durationValue !== undefined
                      ? ` · ${s.durationValue} ${t(s.durationUnit ?? 'days')}`
                      : ''}
                    {/* Kept visible so a later reviewer can tell a symptom that
                        was spoken from one that was tapped. The clinical value is
                        identical; the provenance is not. */}
                    {s.source === 'tap' ? ` · ${t('tapped')}` : ''}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}

          {parsed.rejected.length > 0 ? (
            <Banner
              tone="danger"
              title={t('voiceUncertain')}
              detail={parsed.rejected
                .map((r) => `${r.kind} ${r.value} (“${r.excerpt}”)`)
                .join('; ')}
            />
          ) : null}
        </>
      ) : null}

      {(parsed?.flags ?? []).map((f) => (
        <Banner
          key={f.label}
          tone={f.severity === 'high' ? 'danger' : f.severity === 'medium' ? 'warn' : 'info'}
          title={`${t('triage')}: ${f.label}`}
          detail={f.detail}
        />
      ))}

      <View style={styles.actions}>
        <Button title={t('reRecord')} variant="secondary" onPress={() => setTranscript('')} />
        <Button title={t('saveVisit')} disabled={blocked} onPress={() => void onSave()} testID="save-visit" />
      </View>
    </ScrollView>
  );
}

/** Shown above the extracted value so the worker knows what to double-check. */
const UNCERTAINTY_LABEL: Record<string, string> = {
  asr_low_confidence: 'Unclear audio',
  unbound_number: 'Number not linked to a measurement',
  out_of_range: 'Outside the safe range',
  ambiguous_binding: 'Unclear which measurement this is',
  unit_inferred: 'Unit was assumed, not spoken',
  no_duration: 'How long?',
};

function VitalRow({ vital }: { vital: ParsedVital }) {
  const t = useT();
  const value =
    vital.secondaryValue !== undefined
      ? `${vital.value ?? '—'}/${vital.secondaryValue} ${vital.unit}`
      : `${vital.value ?? '—'} ${vital.unit}`;
  return (
    <Card>
      <View style={styles.vitalRow}>
        <Text style={styles.vitalLabel}>{vital.display}</Text>
        <Pill text={vital.confidence} tone={vital.confidence === 'high' ? 'ok' : 'warn'} />
      </View>
      <Text style={styles.vitalValue}>{value}</Text>
      <Body muted>
        {t('didYouSay')} “{vital.matchedText}”
      </Body>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(2), gap: space(1.5) },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(1), padding: space(2), backgroundColor: colors.bg },
  mic: {
    minHeight: TAP_MIN * 2.2,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(0.75),
  },
  input: {
    minHeight: TAP_MIN * 1.5,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space(1.25),
    textAlignVertical: 'top',
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  vitalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(1) },
  vitalLabel: { ...type.body, color: colors.text, fontWeight: '700' },
  vitalValue: { ...type.display, color: colors.primary },
  actions: { flexDirection: 'row', gap: space(1) },
  uncertainty: { paddingVertical: space(0.75), gap: 2 },
  uncertaintyReason: { ...type.label, color: colors.accent, fontWeight: '700' },
});
