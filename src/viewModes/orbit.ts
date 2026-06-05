/**
 * 3D ビュー（ViewMode === 'orbit'）のパラメータスキーマと表示メタ。描画は SceneRenderer 側。
 * orbit のときは OrbitViewer がマウントされ EFFECT_DESCRIPTORS（EffectRenderer / EffectViewer）経路は走らない。
 */
import type { EffectParamSchema } from '../types';

/** 3D ビューのパラメータスキーマ（one source of truth）。 */
export const ORBIT_PARAM_SCHEMA: readonly EffectParamSchema[] = [
  {
    name: 'depthScale',
    label: '奥行きの強さ',
    type: 'float',
    min: 0.0,
    max: 2.0,
    default: 0.8,
    step: 0.05,
  },
  {
    name: 'autoRotate',
    label: '自動回転',
    type: 'bool',
    default: false,
  },
];

/** Peek 表示でミニスライダーに出す代表パラメータ。 */
export const ORBIT_PRIMARY_PARAM = 'depthScale';

// 表示名は i18n 辞書（t.viewMode.orbit）で解決する。ラベル訳は locale 側に集約。
