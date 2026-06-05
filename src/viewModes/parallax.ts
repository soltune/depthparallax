/** 視差ビュー（ViewMode === 'parallax'）の運用デフォルトと表示名。 */
import type { ParallaxConfig } from '../types';

/** ParallaxConfig のデフォルト値。 */
export const DEFAULT_PARALLAX_CONFIG: ParallaxConfig = {
  maxDisplacement: 30,
  smoothing: 0.15,
  useGyro: false,
  invertDirection: false,
  edgeZoom: 1.05,
};

// 表示名は i18n 辞書（t.viewMode.parallax）で解決する。ラベル訳は locale 側に集約。
