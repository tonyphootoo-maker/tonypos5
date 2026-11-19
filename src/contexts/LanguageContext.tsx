import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Language } from '../types';
import { translations } from '../i18n/translations';

export const LANGUAGE_STORAGE_KEY = 'kinpos_language';

export type TranslationSet = (typeof translations)['th'];

export interface LanguageContextValue {
  lang: Language;
  setLang: (next: Language | ((prev: Language) => Language)) => void;
  toggleLang: () => void;
  t: TranslationSet;
}

export function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'th';
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'en' || saved === 'th') {
      return saved;
    }
  } catch {
    // Ignore storage access errors (e.g. restricted iframe/private browsing)
  }
  return 'th';
}

function persistLanguage(lang: Language): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Ignore storage write errors
  }
  try {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  } catch {
    // Ignore DOM errors
  }
}

export function useStoredLanguage() {
  const [lang, setLangState] = useState<Language>(() => readStoredLanguage());

  useEffect(() => {
    persistLanguage(lang);
  }, [lang]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY) {
        if (event.newValue === 'en' || event.newValue === 'th') {
          setLangState((prev) => (prev === event.newValue ? prev : (event.newValue as Language)));
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLang = useCallback(
    (next: Language | ((prev: Language) => Language)) => {
      setLangState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        const normalized: Language = resolved === 'en' ? 'en' : 'th';
        persistLanguage(normalized);
        return normalized;
      });
    },
    []
  );

  const toggleLang = useCallback(() => {
    setLang((prev) => (prev === 'th' ? 'en' : 'th'));
  }, [setLang]);

  return { lang, setLang, toggleLang };
}

const defaultLanguage = readStoredLanguage();

export const LanguageContext = createContext<LanguageContextValue>({
  lang: defaultLanguage,
  setLang: () => {},
  toggleLang: () => {},
  t: translations[defaultLanguage],
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { lang, setLang, toggleLang } = useStoredLanguage();

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      toggleLang,
      t: translations[lang],
    }),
    [lang, setLang, toggleLang]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
