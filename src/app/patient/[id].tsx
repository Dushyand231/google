import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Banner, Body, Button, Card, Heading, Pill } from '@/components/ui';
import { colors, space } from '@/components/theme';
import { useT } from '@/i18n';
import { getPatient, type Patient } from '@/lib/patients';

export default function PatientScreen() {
  const t = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);

  useEffect(() => {
    void (async () => {
      if (typeof id === 'string') setPatient(await getPatient(id));
    })();
  }, [id]);

  if (!patient) {
    return (
      <View style={styles.center}>
        <Body muted>{t('notFound')}</Body>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Heading>{patient.name}</Heading>
        <Body muted>
          {patient.ageYears}y · {t(patient.sex)} · {patient.village}
        </Body>
        {patient.phone ? <Body muted>{patient.phone}</Body> : null}
        <Pill text={patient.consent ? t('consent') : t('consent')} tone={patient.consent ? 'ok' : 'warn'} />
      </Card>

      {!patient.consent ? (
        <Banner tone="warn" title={t('consent')} detail={t('consentGiven')} />
      ) : null}

      <Button
        title={t('startVoiceVisit')}
        onPress={() => router.push(`/visit/${patient.id}`)}
        testID="start-visit"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(2), gap: space(1.5) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
