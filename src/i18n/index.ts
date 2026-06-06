/**
 * 軽量自作 i18n の中核（React 非依存。Provider / hook は LanguageProvider.tsx）。
 * 言語追加は SUPPORTED_LANGUAGES に足し Dictionary 実装の locale を増やすだけ。各言語が同一型を
 * 満たすことでキー漏れをコンパイル時に検出する。
 */
import type { EffectType } from '../types';
import { ja } from './locales/ja';
import { en } from './locales/en';

export const SUPPORTED_LANGUAGES = ['ja', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** エフェクト 1 種ぶんの訳語。params / bipolar / options は持つエフェクトのみ。 */
export interface EffectLocale {
  /** タブ等に出すエフェクト名（descriptor.displayName の訳） */
  name: string;
  /** パラメータ名（EffectParamSchema.name）→ ラベル訳。未指定キーは descriptor 既定にフォールバック */
  params?: Record<string, string>;
  /** bipolar スライダーの方向ラベル訳（負側 / 正側） */
  bipolar?: Record<string, { negative: string; positive: string }>;
  /** enum パラメータの選択肢ラベル訳（options 配列と同順） */
  options?: Record<string, readonly string[]>;
}

/**
 * 全表示文字列の辞書型。各言語の locale はこの型を満たす（= キー漏れ検出）。
 * 補間が必要な文字列は `{name}` プレースホルダを含み、{@link format} で展開する。
 */
export interface Dictionary {
  lang: { ja: string; en: string; selectAria: string };
  app: {
    backend: string;
    /** バックエンド切替セレクトの tooltip */
    backendHint: string;
    /** バックエンド切替セレクトの aria-label */
    backendSelectAria: string;
    errorPrefix: string;
    reload: string;
    dismissError: string;
    inputPreview: string;
    loadingImage: string;
    processing: string;
    analyzingDepth: string;
    cancel: string;
    footerModel: string;
    /** `{ms}` `{w}` `{h}` を含む */
    inferenceTime: string;
    /** ヘッダーの GitHub リンクの aria-label / tooltip */
    github: string;
  };
  samples: { outdoor: string; portrait: string; city: string };
  progress: { downloading: string; preparing: string; analyzing: string };
  dropzone: {
    pickAria: string;
    cta: string;
    formats: string;
    trySamples: string;
    capture: string;
  };
  picker: {
    sectionAria: string;
    fromFile: string;
    capture: string;
  };
  effectPanel: {
    groupFilter: string;
    groupMotion: string;
    groupsAria: string;
    noEffect: string;
    scrollLeft: string;
    scrollRight: string;
    noParams: string;
    reset: string;
  };
  viewMode: { aria: string; parallax: string; orbit: string };
  controlBar: {
    strength: string;
    gyro: string;
  };
  orbit: {
    params: Record<string, string>;
    autoRotateLabel: string;
  };
  /** 再生 / 停止系の共通ラベル（DollyPlayControl / AutoRotateButton で共有） */
  common: { play: string; stop: string; playButton: string; stopButton: string };
  dolly: { autoplay: string; progressAria: string };
  focal: { label: string; auto: string; autoHint: string };
  miniPrimary: {
    groupAria: string;
    modeAria: string;
    noEffect: string;
    dollyPlay: string;
    dollyStop: string;
  };
  depthMap: {
    showToggle: string;
    enhanceToggle: string;
    enhanceTooltip: string;
    pipAria: string;
    modalAria: string;
    close: string;
    caption: string;
    near: string;
    far: string;
  };
  bottomSheet: { expand: string; collapse: string };
  webglError: { title: string; body: string };
  effects: Record<EffectType, EffectLocale>;
}

export const DICTIONARIES: Record<Language, Dictionary> = { ja, en };

/**
 * ブラウザ言語から初期言語を判定する。先頭が `ja` のものがあれば日本語、それ以外は英語。
 * navigator が無い（SSR/テスト）環境では英語にフォールバックする。
 */
export function detectLanguage(): Language {
  const list =
    typeof navigator !== 'undefined'
      ? navigator.languages ?? (navigator.language ? [navigator.language] : [])
      : [];
  for (const l of list) {
    if (l && l.toLowerCase().startsWith('ja')) return 'ja';
  }
  return 'en';
}

/**
 * URL の `?lang=ja|en` をセッション限定の初期シードとして読む（localStorage 不使用）。
 * {@link SUPPORTED_LANGUAGES} 以外・未指定は null。リロード後も URL に残るため選択が
 * 保たれ、リンク共有もできる（`?backend=` と同じ方針）。
 */
export function readLanguageOverride(): Language | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('lang');
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value ?? '')
    ? (value as Language)
    : null;
}

/** `{key}` プレースホルダを params の値で置換する。params 未指定ならそのまま返す。 */
export function format(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in params ? String(params[k]) : `{${k}}`,
  );
}
