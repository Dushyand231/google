/**
 * Shown while the stored session is read back from the device.
 *
 * This exists because reading a session touches SQLite and SecureStore, which
 * is async, so for a moment the app genuinely does not know whether anyone is
 * signed in. Rendering the patient list first and then swapping it for the
 * login screen would flash the wrong screen and, worse, briefly show one
 * health worker's list to the next person to pick up the handset.
 */

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, space, type } from './theme';
import { useT } from '@/i18n';

export function BootSplash({ label }: { label?: string }) {
  const t = useT();
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={label ?? t('loading')}>
      <View style={styles.badge}>
        <Text style={styles.mark} accessibilityElementsHidden>
          {String.fromCodePoint(0x0dca, 0x0bb0, 0x0b95, 0x0b9a)}
        </Text>
      </View>
      <Text style={styles.title}>JeevaCare</Text>
      <Text style={styles.tagline}>{t('appTagline')}</Text>
      <ActivityIndicator
        size="large"
        color={colors.primaryText}
        style={styles.spinner}
        accessibilityLabel={label ?? t('loading')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(0.5),
    padding: space(3),
  },
  badge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryText,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(1),
  },
  mark: { fontSize: 44, color: colors.primary, fontWeight: '700' },
  title: { ...type.title, color: colors.primaryText, fontSize: 30 },
  tagline: { ...type.body, color: colors.primaryText, opacity: 0.9, textAlign: 'center' },
  spinner: { marginTop: space(2) },
});
