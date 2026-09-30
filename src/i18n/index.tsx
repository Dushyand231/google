import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import en from './en.json';
import hi from './hi.json';
import kn from './kn.json';
import ml from './ml.json';
import ta from './ta.json';
import te from './te.json';

export const SUPPORTED = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം' },
] as const;

export type LangCode = (typeof SUPPORTED)[number]['code'];

const TRANSLATIONS: Record<string, Record<string, string>> = { en, ta, hi, te, kn, ml };

export const i18n = new I18n(TRANSLATIONS);
i18n.enableFallback = true;
i18n.defaultLocale = 'en';

const LANG_KEY = 'jeevacare:lang';

const deviceLang = getLocales()[0]?.languageCode ?? 'en';
const initial: LangCode = (SUPPORTED.find((s) => s.code === deviceLang)?.code ??
  'en') as LangCode;
i18n.locale = initial;

interface I18nValue {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** false until the stored preference has been read back from the device */
  hydrated: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(initial);
  const [hydrated, setHydrated] = useState(false);

  // A chosen language has to survive an app restart, otherwise a health
  // worker who cannot read the default language re-picks it on every launch.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let stored: string | null = null;
      try {
        const SecureStore = await import('expo-secure-store');
        stored = await SecureStore.getItemAsync(LANG_KEY);
      } catch {
        // expo-secure-store has no web implementation; the device locale stands.
      }
      if (cancelled) return;
      const picked = SUPPORTED.find((s) => s.code === stored)?.code;
      if (picked) {
        i18n.locale = picked;
        setLangState(picked);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLang = useCallback((l: LangCode) => {
    setLangState(l);
    i18n.locale = l;
    void (async () => {
      try {
        const SecureStore = await import('expo-secure-store');
        await SecureStore.setItemAsync(LANG_KEY, l);
      } catch {
        // Preference stays for this session only.
      }
    })();
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      i18n.t(key, params as never) as string,
    []
  );

  const value = useMemo(() => ({ lang, setLang, t, hydrated }), [lang, setLang, t, hydrated]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

export function useT() {
  return useI18n().t;
}
