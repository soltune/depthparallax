/**
 * 言語状態を供給する React Context。初期言語は URL の ?lang= 優先、無ければブラウザ言語。手動選択は
 * state を上書きしつつ ?lang= を replaceState で同期（localStorage 不使用・URL のみで永続化: ?backend= と同方針）。
 * 言語変更時に <html lang> を同期。t は現在言語の辞書そのもの（補間は format() を使う）。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DICTIONARIES,
  detectLanguage,
  format,
  readLanguageOverride,
  type Dictionary,
  type Language,
} from './index';

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Dictionary;
  format: typeof format;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(
    () => readLanguageOverride() ?? detectLanguage(),
  );

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // state 反映 + URL の ?lang= を replaceState で同期（永続化は URL のみ）。
  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', next);
      window.history.replaceState(null, '', url);
    } catch {
      /* URL 同期失敗は無視（切替自体はメモリ上で成立済み） */
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t: DICTIONARIES[lang], format }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within a LanguageProvider');
  return ctx;
}
