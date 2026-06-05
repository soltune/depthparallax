/** プラットフォーム判定の共通ユーティリティ。 */

/** モバイル端末か判定する（タッチポイント or UA。navigator 未定義時は false）。 */
export function detectMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || /Mobi|Android/i.test(navigator.userAgent);
}

/**
 * iOS (iPhone/iPad/iPod) 判定。onnxruntime-web の JSEP WASM バグ回避で iOS は WASM 強制。
 * iPadOS はデスクトップサイト要求時に UA が "Macintosh" になるため maxTouchPoints も併用する。
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

/**
 * モバイルは devicePixelRatio を 1.5 に頭打ち（デスクトップは素通し）。
 * DPR=3 端末で重量エフェクト（DoF / Tilt-shift）が 30fps を割るのを防ぐ妥協値。
 */
export function clampedDpr(isMobile: boolean): number {
  const dpr = window.devicePixelRatio || 1;
  return isMobile ? Math.min(dpr, 1.5) : dpr;
}
