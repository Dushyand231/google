import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Button, Card, Heading, Label, Pill } from '@/components/ui';
import { colors, space, type } from '@/components/theme';
import { useT } from '@/i18n';
import { currentSyncStatus, loadSession, syncNow } from '@/lib/api';
import { AutoSync, type AutoSyncState } from '@/lib/autosync';
import { conflicts, resolveConflict, type SyncStatus } from '@/lib/sync';

export default function SyncScreen() {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [open, setOpen] = useState<Awaited<ReturnType<typeof conflicts>>>([]);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState<AutoSyncState | null>(null);

  const load = useCallback(async () => {
    const session = await loadSession();
    setStatus(await currentSyncStatus(session));
    setOpen(await conflicts());
  }, []);

  // Mirror the app-wide loop's state rather than starting a second one, so the
  // screen and the background syncer can never disagree about what is pending.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void loadSession().then((session) => {
      if (cancelled || !session?.token) return;
      const instance = new AutoSync({ baseUrl: session.baseUrl, token: session.token });
      unsub = instance.subscribe(setAuto);
      // Observe only: the loop itself already runs in the root layout, and
      // starting a second one here would double every upload.
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const onSync = useCallback(async () => {
    setBusy(true);
    try {
      const session = await loadSession();
      if (session) {
        await syncNow({
          baseUrl: session.baseUrl,
          token: session.token,
          isOnline: () => status?.online !== false,
        });
      }
      await load();
    } finally {
      setBusy(false);
    }
  }, [load, status?.online]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.row}>
          <Heading>{t('syncStatus')}</Heading>
          <Pill
            text={status?.online ? t('online') : t('offline')}
            tone={status?.online ? 'ok' : 'warn'}
          />
        </View>
        <Label>{t('queued')}</Label>
        <Text style={styles.big}>{auto?.pending ?? status?.pending ?? '—'}</Text>
        <Label>{t('synced')}</Label>
        <Body muted>
          {status?.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : t('noPending')}
        </Body>
      </Card>

      {status?.lastError ? (
        <Banner tone="warn" title={t('workingOffline')} detail={status.lastError} />
      ) : null}

      {auto && auto.phase === 'syncing' ? (
        <Banner tone="info" title={t('syncing')} detail={t('queued')} />
      ) : null}

      <Button title={busy ? t('syncing') : t('syncNow')} onPress={onSync} disabled={busy} />

      {open.length > 0 ? (
        <Card>
          <Heading>{t('followUp')}</Heading>
          {open.map((c) => (
            <View key={c.opId} style={styles.conflict}>
              <Body>
                {c.entityId} · {c.reason}
              </Body>
              <Body muted>
                {t('role')}: {String((c.serverRecord as { name?: string }).name ?? '—')}
              </Body>
              <Button
                title={t('confirm')}
                variant="secondary"
                onPress={() => void resolveConflict(c.opId).then(load)}
              />
            </View>
          ))}
        </Card>
      ) : null}

      <Button title={t('back')} variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(2), gap: space(1.5) },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(1) },
  big: { ...type.display, color: colors.text },
  conflict: { gap: space(0.75), paddingVertical: space(1), borderTopWidth: 1, borderTopColor: colors.border },
});
