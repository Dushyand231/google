import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Button, Card, Heading, Pill } from '@/components/ui';
import { colors, radius, space, TAP_MIN, type } from '@/components/theme';
import { useT } from '@/i18n';
import { currentSyncStatus, loadSession } from '@/lib/api';
import { listPatients, type Patient } from '@/lib/patients';
import type { SyncStatus } from '@/lib/sync';

const TILE_SIZE = 104;

export default function HomeScreen() {
  const t = useT();
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const session = await loadSession();
    const [list, sync] = await Promise.all([
      session ? listPatients(session.workerId) : Promise.resolve([]),
      currentSyncStatus(session),
    ]);
    setPatients(list);
    setStatus(sync);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const syncTone = !status ? 'info' : !status.online ? 'warn' : status.pending > 0 ? 'warn' : 'ok';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('syncStatus')}
        onPress={() => router.push('/sync')}
        style={styles.statusRow}
      >
        <View style={styles.statusText}>
          <Body muted>{t('syncStatus')}</Body>
          <Text style={styles.statusValue}>
            {status === null
              ? '…'
              : !status.online
                ? t('workingOffline')
                : status.pending > 0
                  ? t('pendingCount', { count: status.pending })
                  : t('allSynced')}
          </Text>
        </View>
        <Pill
          text={status?.online ? t('online') : t('offline')}
          tone={syncTone === 'info' ? 'info' : syncTone}
        />
      </Pressable>

      {status?.conflicts ? (
        <Banner
          tone="danger"
          title={t('followUp')}
          detail={t('pendingCount', { count: status.conflicts })}
        />
      ) : null}

      <View style={styles.tiles}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('addPatient')}
          onPress={() => router.push('/patient/new')}
          style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.tileEmoji} accessible={false}>
            ＋
          </Text>
          <Text style={styles.tileLabel}>{t('addPatient')}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('findPatient')}
          onPress={() => {}}
          style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.tileEmoji} accessible={false}>
            🔎
          </Text>
          <Text style={styles.tileLabel}>{t('findPatient')}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('visitsToday')}
          onPress={() => {}}
          style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.tileEmoji} accessible={false}>
            📋
          </Text>
          <Text style={styles.tileLabel}>{t('todaysVisits')}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings')}
          onPress={() => router.push('/settings')}
          style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.tileEmoji} accessible={false}>
            ⚙️
          </Text>
          <Text style={styles.tileLabel}>{t('settings')}</Text>
        </Pressable>
      </View>

      <Heading>{t('myPatients')}</Heading>
      {patients.length === 0 ? (
        <Card>
          <Body muted>{t('noVisits')}</Body>
        </Card>
      ) : (
        patients.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            onPress={() => router.push(`/patient/${p.id}`)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{p.name}</Text>
              <Text style={styles.rowSub}>
                {p.ageYears}y · {p.sex} · {p.village}
              </Text>
            </View>
            <Pill text={p.consent ? t('consent') : '—'} tone={p.consent ? 'ok' : 'warn'} />
          </Pressable>
        ))
      )}

      <Button title={t('addPatient')} onPress={() => router.push('/patient/new')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(2), gap: space(1.5) },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(1),
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(1.5),
    minHeight: TAP_MIN,
  },
  statusText: { flex: 1, gap: 2 },
  statusValue: { ...type.body, color: colors.text, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE + 16,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(0.75),
    gap: space(0.5),
  },
  tileEmoji: { fontSize: 34, color: colors.primaryText },
  tileLabel: { ...type.label, color: colors.primaryText, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(1.5),
    minHeight: TAP_MIN + 8,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { ...type.body, color: colors.text, fontWeight: '700' },
  rowSub: { ...type.label, color: colors.textMuted, fontWeight: '500' },
});
