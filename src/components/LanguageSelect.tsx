import { useI18n } from '../i18n/LanguageProvider';
import { SUPPORTED_LANGUAGES, type Language } from '../i18n';

/**
 * 言語切替セレクトボックス。ヘッダーの Backend バッジ右に配置する。
 * 初期値は自動判定（ブラウザ言語）。選択するとその指定が優先される（セッション限り）。
 */
export function LanguageSelect() {
  const { lang, setLang, t } = useI18n();

  return (
    <select
      className="dp-lang-select"
      value={lang}
      onChange={(e) => setLang(e.target.value as Language)}
      aria-label={t.lang.selectAria}
    >
      {SUPPORTED_LANGUAGES.map((code) => (
        <option key={code} value={code}>
          {t.lang[code]}
        </option>
      ))}
    </select>
  );
}
