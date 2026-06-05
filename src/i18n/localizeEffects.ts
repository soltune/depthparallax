/**
 * エフェクト記述子 / パラメータスキーマの表示ラベルを locale で差し替えるヘルパー。
 * descriptor は React 非依存（不変条件）なので改変せず、UI へ渡す直前に「ラベルだけ訳した複製」を作る。
 * 機能フィールド（name/type/min/max/...）は原本のまま。訳が無いキーは原本ラベルにフォールバックする。
 */
import type { EffectDescriptor, EffectParamSchema } from '../types';
import type { Dictionary, EffectLocale } from './index';

function localizeParam(p: EffectParamSchema, loc: EffectLocale | undefined): EffectParamSchema {
  const next: EffectParamSchema = { ...p, label: loc?.params?.[p.name] ?? p.label };
  const bipolar = loc?.bipolar?.[p.name];
  if (p.bipolarLabels && bipolar) next.bipolarLabels = bipolar;
  const options = loc?.options?.[p.name];
  if (p.options && options) {
    next.options = p.options.map((o, i) => ({ value: o.value, label: options[i] ?? o.label }));
  }
  return next;
}

/** 単一の EffectDescriptor をラベル訳した複製にする。 */
export function localizeDescriptor(e: EffectDescriptor, dict: Dictionary): EffectDescriptor {
  const loc = dict.effects[e.type];
  return {
    ...e,
    displayName: loc?.name ?? e.displayName,
    params: e.params.map((p) => localizeParam(p, loc)),
  };
}

/** EffectDescriptor 配列をまとめてラベル訳する（UI 用の複製）。 */
export function localizeEffects(
  effects: readonly EffectDescriptor[],
  dict: Dictionary,
): EffectDescriptor[] {
  return effects.map((e) => localizeDescriptor(e, dict));
}

/** 汎用パラメータスキーマ（ORBIT_PARAM_SCHEMA 等）のラベルを name → 訳マップで差し替える。 */
export function localizeParamSchema(
  schema: readonly EffectParamSchema[],
  labels: Record<string, string>,
): EffectParamSchema[] {
  return schema.map((p) => ({ ...p, label: labels[p.name] ?? p.label }));
}
