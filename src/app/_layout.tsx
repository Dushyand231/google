import { Stack, useFocusEffect, useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BootSplash } from '@/components/BootSplash';
import { colors } from '@/components/theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AutoSync } from '@/lib/autosync';
import { I18nProvider } from '@/i18n';

/**
 * Keeps one AutoSync alive for the whole signed-in session.
 *
 * The ref matters: a fresh instance per render would restart the health timer
 * on every state change and never actually poll. `onFocus` is what covers the
 * "worker opens the app, signal just came back" case, and start() covers the
 * backlog left behind by a previous run.
 */
function useAutoSync(baseUrl: string | undefined, token: string | undefined): void {
  const ref = useRef<AutoSync | null>(null);

  useEffect(() => {
    if (!baseUrl || !token) {
      ref.current?.stop();
      ref.current = null;
      return;
    }
    const instance = new AutoSync({ baseUrl, token });
    ref.current = instance;
    instance.start();
    return () => {
      instance.stop();
      ref.current = null;
    };
  }, [baseUrl, token]);

  useFocusEffect(
    useCallback(() => {
      void ref.current?.check(false);
    }, [])
  );
}

/**
 * Auth gate.
 *
 * The redirect is skipped while the session is still being read so a signed-in
 * worker is not bounced to the login screen for the few hundred milliseconds
 * SQLite takes to answer, and back again once it does.
 */
function Gate() {
  const { session, hydrated } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useAutoSync(session?.baseUrl, session?.token);

  const onLogin = segments[0] === 'login';

  useEffect(() => {
    if (!hydrated) return;
    if (!session && !onLogin) router.replace('/login');
    else if (session && onLogin) router.replace('/');
  }, [hydrated, session, onLogin, router]);

  if (!hydrated) return <BootSplash />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.primaryText,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'JeevaCare' }} />
      <Stack.Screen name="login" options={{ title: '', headerShown: false }} />
      <Stack.Screen name="patient/new" options={{ title: 'New patient' }} />
      <Stack.Screen name="patient/[id]" options={{ title: 'Patient' }} />
      <Stack.Screen name="visit/[id]" options={{ title: 'Record visit' }} />
      <Stack.Screen name="sync" options={{ title: 'Sync' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
