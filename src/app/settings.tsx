import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Card, Heading, Label, Pill } from '@/components/ui';
import { colors, radius, space, TAP_MIN, type } from '@/components/theme';
import { SUPPORTED, useI18n, useT, type LangCode } from '@/i18n';
import { DEFAULT_BASE_URL, useAuth } from '@/lib/auth';
import { getDeviceId } from '@/lib/sync';

export default function SettingsScreen() {
  const t = useT();
  const { lang, setLang } = useI18n();
  const { session, signOut, busy } = useAuth();
  const [device, setDevice] = useState<string>('');

  useEffect(() => {
    void (async () => {
      setDevice(await getDeviceId());
    })();
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Heading>{t('language')}</Heading>
      <View style={styles.langGrid}>
        {SUPPORTED.map((option) => (
          <Pressable
            key={option.code}
            accessibilityRole="radio"
            accessibilityState={{ selected: lang === option.code }}
            onPress={() => setLang(option.code as LangCode)}
            style={({ pressed }) => [
              styles.langTile,
              lang === option.code && styles.langTileOn,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.langNative}>{option.native}</Text>
            <Text style={styles.langLabel}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <Heading>{t('role')}</Heading>
      <Card>
        <Label>{t('signedInAs')}</Label>
        <Body>{session?.name || session?.workerId || '—'}</Body>
        <Label>{t('workerId')}</Label>
        <Body>{session?.workerId ?? '—'}</Body>
        <Label>{t('device')}</Label>
        <Text style={styles.mono}>{device || '—'}</Text>
      </Card>

      <Card>
        <Label>{t('connectivity')}</Label>
        <View style={styles.row}>
          <Body>{session?.baseUrl ?? DEFAULT_BASE_URL}</Body>
          <Pill
          text={session?.offline ? t('offlineMode') : session ? t('connected') : t('offline')}
          tone={session && !session.offline ? 'ok' : 'warn'}
        />
        </View>
        <Body muted>
          {t('device')}: {session?.offline ? t('offlineModeExplain') : session ? t('connected') : t('workingOffline')}
        </Body>
      </Card>

      {session ? (
        <Button
          title={t('signOut')}
          variant="danger"
          disabled={busy}
          onPress={() => void signOut()}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(2), gap: space(1.5) },
  langGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  langTile: {
    minWidth: 140,
    minHeight: TAP_MIN + 8,
    flexGrow: 1,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: space(1),
    justifyContent: 'center',
    gap: 2,
  },
  langTileOn: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  langNative: { ...type.body, color: colors.text, fontWeight: '700' },
  langLabel: { ...type.label, color: colors.textMuted, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(1) },
  mono: { ...type.label, color: colors.text, fontFamily: 'monospace' },
});
