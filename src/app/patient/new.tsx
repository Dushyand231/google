/**
 * Registration wizard: one question per screen.
 *
 * Deliberately not a scrolling form. A health worker in a village clinic is
 * often reading a question aloud to someone who cannot read, and one
 * question at a time is what makes the aloud-reading possible.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Body, Button, Card, Heading, Label } from '@/components/ui';
import { colors, radius, space, TAP_MIN, type } from '@/components/theme';
import { useT } from '@/i18n';
import { loadSession } from '@/lib/api';
import { createPatient, type Patient } from '@/lib/patients';
import { numeralToNumber } from '@/lib/numwords';

type Step = 0 | 1 | 2 | 3 | 4;
const STEPS = 5;

export default function NewPatientScreen() {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Patient['sex'] | null>(null);
  const [village, setVillage] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ageYears = numeralToNumber(age);

  const canAdvance =
    (step === 0 && name.trim().length > 0) ||
    (step === 1 && ageYears !== null && ageYears >= 0 && ageYears <= 120) ||
    (step === 2 && sex !== null) ||
    (step === 3 && village.trim().length > 0) ||
    step === 4;

  async function finish() {
    if (!sex) return;
    setSaving(true);
    setError(null);
    try {
      const session = await loadSession();
      if (!session) {
        setError(t('settings'));
        return;
      }
      const patient = await createPatient({
        name,
        ageYears: ageYears ?? 0,
        sex,
        village,
        phone: phone || undefined,
        consent,
        workerId: session.workerId,
      });
      router.replace(`/patient/${patient.id}`);
    } catch {
      setError(t('workingOffline'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.progress} accessibilityLabel={`${step + 1} / ${STEPS}`}>
          {Array.from({ length: STEPS }, (_, i) => (
            <View key={i} style={[styles.progressBar, i <= step && styles.progressBarOn]} />
          ))}
        </View>

        {step === 0 ? (
          <>
            <Heading>{t('name')}</Heading>
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.input}
              autoFocus
              placeholder={t('name')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('name')}
            />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Heading>{t('age')}</Heading>
            <TextInput
              value={age}
              onChangeText={setAge}
              style={styles.input}
              keyboardType="number-pad"
              autoFocus
              accessibilityLabel={t('age')}
            />
            {ageYears !== null ? (
              <Body muted>
                {t('extracted')}: {ageYears}
              </Body>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Heading>{t('sex')}</Heading>
            <View style={styles.choices}>
              {(['male', 'female'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sex === value }}
                  onPress={() => setSex(value)}
                  style={({ pressed }) => [
                    styles.choice,
                    sex === value && styles.choiceOn,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={styles.choiceEmoji} accessible={false}>
                    {value === 'male' ? '👨' : '👩'}
                  </Text>
                  <Text style={styles.choiceText}>{t(value)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Heading>{t('village')}</Heading>
            <TextInput
              value={village}
              onChangeText={setVillage}
              style={styles.input}
              autoFocus
              accessibilityLabel={t('village')}
            />
            <Label>{t('phoneOptional')}</Label>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              style={styles.input}
              keyboardType="phone-pad"
              accessibilityLabel={t('phoneOptional')}
            />
          </>
        ) : null}

        {step === 4 ? (
          <Card>
            <Heading>{t('consent')}</Heading>
            <Body>{t('consentGiven')}</Body>
            <View style={styles.consentRow}>
              <Text style={styles.consentText}>{t('yes')}</Text>
              <Switch
                value={consent}
                onValueChange={setConsent}
                accessibilityLabel={t('consentGiven')}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          </Card>
        ) : null}

        {error ? <Body muted>{error}</Body> : null}

        <View style={styles.actions}>
          {step > 0 ? (
            <Button
              title={t('back')}
              variant="secondary"
              onPress={() => setStep((s) => (s - 1) as Step)}
            />
          ) : null}
          <Button
            title={step === STEPS - 1 ? t('save') : t('next')}
            disabled={!canAdvance || saving}
            onPress={() => (step === STEPS - 1 ? void finish() : setStep((s) => (s + 1) as Step))}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(2), gap: space(1.5) },
  progress: { flexDirection: 'row', gap: space(0.5), marginBottom: space(1) },
  progressBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
  progressBarOn: { backgroundColor: colors.primary },
  input: {
    minHeight: TAP_MIN,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space(1.5),
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  choices: { flexDirection: 'row', gap: space(1) },
  choice: {
    flex: 1,
    minHeight: 140,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(0.5),
  },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  choiceEmoji: { fontSize: 44 },
  choiceText: { ...type.body, color: colors.text, fontWeight: '700' },
  consentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  consentText: { ...type.body, color: colors.text },
  actions: { flexDirection: 'row', gap: space(1) },
});
