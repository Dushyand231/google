/**
 * Sign-in.
 *
 * The language picker is on this screen on purpose. A worker who cannot read
 * the default language cannot get past a login form written in that language,
 * and the only place to fix that is before they are signed in.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Banner, Body, Button, Card, Field, Heading, Label } from '@/components/ui';
import { colors, radius, space, TAP_MIN, type } from '@/components/theme';
import { SUPPORTED, useI18n, useT, type LangCode } from '@/i18n';
import { DEFAULT_BASE_URL, SignInError, useAuth } from '@/lib/auth';

export default function LoginScreen() {
  const t = useT();
  const router = useRouter();
  const { lang, setLang } = useI18n();
  const { signIn, continueOffline, busy } = useAuth();

  const [workerId, setWorkerId] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [error, setError] = useState<SignInError | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const validate = (): boolean => {
    if (workerId.trim().length === 0) {
      setFieldError(t('required'));
      return false;
    }
    setFieldError(null);
    return true;
  };

  const onSignIn = async () => {
    if (!validate()) return;
    setError(null);
    try {
      await signIn(workerId.trim(), name.trim() || workerId.trim(), baseUrl.trim());
      router.replace('/');
    } catch (e) {
      setError(e instanceof SignInError ? e : new SignInError('unreachable', String(e)));
    }
  };

  const onContinueOffline = async () => {
    if (!validate()) return;
    await continueOffline(workerId.trim(), name.trim() || workerId.trim(), baseUrl.trim());
    router.replace('/');
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Heading>{t('signInTitle')}</Heading>
          <Body muted>{t('signInSubtitle')}</Body>
        </View>

        <Card>
          <Label>{t('chooseLanguage')}</Label>
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
              </Pressable>
            ))}
          </View>
        </Card>

        <Card>
          <Field
            testID="login-worker-id"
            label={t('workerId')}
            value={workerId}
            onChangeText={setWorkerId}
            placeholder="ANM-01"
            error={fieldError}
          />
          <Field
            testID="login-name"
            label={t('name')}
            value={name}
            onChangeText={setName}
            placeholder={t('name')}
            autoCapitalize="words"
          />
          <Field
            testID="login-base-url"
            label={t('serverUrl')}
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder={DEFAULT_BASE_URL}
            keyboardType="url"
          />
        </Card>

        {error ? (
          <Banner
            tone={error.kind === 'rejected' ? 'danger' : 'warn'}
            title={error.kind === 'rejected' ? t('invalidWorkerId') : t('serverUnreachable')}
            detail={error.message}
          />
        ) : null}

        {error && error.kind === 'unreachable' ? (
          <>
            <Button
              testID="login-offline"
              title={t('continueOffline')}
              variant="secondary"
              disabled={busy}
              onPress={() => void onContinueOffline()}
            />
            <Text style={styles.offlineNote}>{t('offlineModeExplain')}</Text>
          </>
        ) : null}

        <Button
          testID="login-submit"
          title={t('signIn')}
          disabled={busy}
          onPress={() => void onSignIn()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(2), gap: space(1.5), paddingBottom: space(4) },
  hero: { gap: space(0.25), marginBottom: space(0.5) },
  langGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  langTile: {
    minHeight: TAP_MIN,
    flexGrow: 1,
    minWidth: 100,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(1),
  },
  langTileOn: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  langNative: { ...type.body, color: colors.text, fontWeight: '700' },
  offlineNote: { ...type.label, color: colors.textMuted, textAlign: 'center' },
});
