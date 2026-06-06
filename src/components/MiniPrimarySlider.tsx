import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ORBIT_PARAM_SCHEMA, ORBIT_PRIMARY_PARAM } from '../viewModes/orbit';
import { useI18n } from '../i18n/LanguageProvider';
import { localizeParamSchema } from '../i18n/localizeEffects';
import type { Dictionary } from '../i18n';
import type {
  EffectDescriptor,
  EffectParamSchema,
  EffectType,
  ViewMode,
} from '../types';

type ParamValue = number | number[] | boolean;
type ParamMap = Record<string, ParamValue>;

/**
 * モバイル縦 Peek 状態の「現在モード + エフェクト名 + primary param ミニスライダー」。
 *
 * - ViewModeTabs は Peek に出さず Half のみ（Peek に小型タブを置くと実機で誤タップ頻発。primary 操作と現状把握に全振り）
 * - primaryParam 未定義のエフェクト（parallax 等）はスライダー非表示でモード/エフェクト名のみ
 * - dolly 選択時は ▶ / ■ ボタン併設（自動再生中は dollyAmount スライダー disable）
 * - 値更新は EffectPanel と同じく rAF throttle
 */
interface MiniPrimarySliderProps {
  viewMode: ViewMode;
  /** 視差ビュー時の選択中エフェクト */
  currentEffect: EffectType;
  /** 視差ビューのエフェクト一覧（primaryParam / params 解決のため） */
  effects: readonly EffectDescriptor[];
  /** 視差ビュー時の現エフェクト params */
  currentParams: ParamMap;
  onParamsChange: (params: ParamMap) => void;
  /** 3D ビュー時の params */
  orbitParams: ParamMap;
  onOrbitParamsChange: (params: ParamMap) => void;
  /** Dolly 自動再生中のとき dollyAmount を disable するための集合 */
  disabledParams?: ReadonlySet<string>;
  /** 親が外部書き込みした時に bump される単調増加トークン（EffectPanel と同様） */
  syncToken?: number;
  /** Dolly 自動再生コントロール（dolly 選択時のみ ▶ を出すために使う） */
  isDollyPlaying: boolean;
  onDollyPlay: () => void;
  onDollyStop: () => void;
}

interface ResolvedPrimary {
  modeLabel: string;
  effectName: string | null;
  schema: EffectParamSchema | null;
  value: ParamValue | undefined;
  onCommit: (value: ParamValue) => void;
}

export function MiniPrimarySlider({
  viewMode,
  currentEffect,
  effects,
  currentParams,
  onParamsChange,
  orbitParams,
  onOrbitParamsChange,
  disabledParams,
  syncToken,
  isDollyPlaying,
  onDollyPlay,
  onDollyStop,
}: MiniPrimarySliderProps) {
  const { t } = useI18n();
  const orbitSchema = useMemo(
    () => localizeParamSchema(ORBIT_PARAM_SCHEMA, t.orbit.params),
    [t],
  );
  const resolved = resolvePrimary({
    viewMode,
    currentEffect,
    effects,
    currentParams,
    onParamsChange,
    orbitParams,
    onOrbitParamsChange,
    t,
    orbitSchema,
  });

  const { schema, value: externalValue, onCommit } = resolved;

  // ローカル state（スライダー操作中の表示値）。 EffectPanel と同じく rAF throttle で
  // 親に伝える。
  const [localValue, setLocalValue] = useState<ParamValue | undefined>(externalValue);
  const localValueRef = useRef<ParamValue | undefined>(externalValue);
  localValueRef.current = localValue;

  // schema / currentEffect / viewMode が変わったとき、 または親が外部書き込み（syncToken）した時に再同期。
  // 連続入力中は自分発の echo なので resync しない。
  useEffect(() => {
    setLocalValue(externalValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema?.name, viewMode, currentEffect, syncToken]);

  const pendingRef = useRef<ParamValue | null>(null);
  const rafRef = useRef<number | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next !== null) onCommitRef.current(next);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const handleChange = useCallback(
    (next: number) => {
      setLocalValue(next);
      pendingRef.current = next;
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const sliderDisabled = schema ? disabledParams?.has(schema.name) ?? false : true;
  const showDollyControl = viewMode === 'parallax' && currentEffect === 'dolly';

  return (
    <div className="dp-mini-primary" role="group" aria-label={t.miniPrimary.groupAria}>
      <div className="dp-mini-primary__header">
        <span className="dp-mini-primary__mode" aria-label={t.miniPrimary.modeAria}>
          {resolved.modeLabel}
        </span>
        {resolved.effectName && (
          <span className="dp-mini-primary__effect">{resolved.effectName}</span>
        )}
        {showDollyControl && (
          <button
            type="button"
            className="dp-mini-primary__play"
            onClick={isDollyPlaying ? onDollyStop : onDollyPlay}
            aria-label={isDollyPlaying ? t.miniPrimary.dollyStop : t.miniPrimary.dollyPlay}
          >
            {isDollyPlaying ? '■' : '▶'}
          </button>
        )}
      </div>
      {schema && schema.type === 'float' && (
        <FloatMiniSlider
          schema={schema}
          value={typeof localValue === 'number' ? localValue : (schema.default as number)}
          disabled={sliderDisabled}
          onChange={handleChange}
        />
      )}
    </div>
  );
}

interface ResolvePrimaryArgs {
  viewMode: ViewMode;
  currentEffect: EffectType;
  effects: readonly EffectDescriptor[];
  currentParams: ParamMap;
  onParamsChange: (params: ParamMap) => void;
  orbitParams: ParamMap;
  onOrbitParamsChange: (params: ParamMap) => void;
  t: Dictionary;
  /** ラベルを訳した orbit パラメータスキーマ */
  orbitSchema: readonly EffectParamSchema[];
}

function resolvePrimary({
  viewMode,
  currentEffect,
  effects,
  currentParams,
  onParamsChange,
  orbitParams,
  onOrbitParamsChange,
  t,
  orbitSchema,
}: ResolvePrimaryArgs): ResolvedPrimary {
  if (viewMode === 'orbit') {
    const schema = orbitSchema.find((p) => p.name === ORBIT_PRIMARY_PARAM) ?? null;
    return {
      modeLabel: t.viewMode.orbit,
      // orbit はモード自体が中身で effectName は出さない（slider に同じ label が出て重複するため）
      effectName: null,
      schema: schema && schema.type === 'float' ? schema : null,
      value: schema ? orbitParams[schema.name] : undefined,
      onCommit: (v) => {
        if (!schema) return;
        onOrbitParamsChange({ [schema.name]: v });
      },
    };
  }

  const desc = effects.find((e) => e.type === currentEffect) ?? null;
  const primaryName = desc?.primaryParam;
  const schema =
    desc && primaryName
      ? desc.params.find((p) => p.name === primaryName) ?? null
      : null;
  return {
    modeLabel: t.viewMode.parallax,
    effectName: desc ? displayNameFor(desc, t) : null,
    schema: schema && schema.type === 'float' ? schema : null,
    value: schema ? currentParams[schema.name] : undefined,
    onCommit: (v) => {
      if (!schema) return;
      onParamsChange({ [schema.name]: v });
    },
  };
}

/**
 * Peek の状態表示用エフェクト名（parallax → 'エフェクト未選択'）。EffectPanel の tabLabelFor は
 * '標準'（あちらは選べるタブなので肯定形、こちらは状態表示なので「未選択」で探索を促す別表記）。
 * Peek と Half は CSS で排他なので表記が異なってよい。
 */
function displayNameFor(desc: EffectDescriptor, t: Dictionary): string {
  if (desc.type === 'parallax') return t.miniPrimary.noEffect;
  return desc.displayName;
}

interface FloatMiniSliderProps {
  schema: EffectParamSchema;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}

function FloatMiniSlider({ schema, value, disabled, onChange }: FloatMiniSliderProps) {
  const min = schema.min ?? 0;
  const max = schema.max ?? 1;
  const step = schema.step ?? 0.01;
  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  // 双極パラメータは中央ティックのみ表示（中央スナップ・方向ラベルは EffectPanel 側）。
  const showCenterTick = schema.bipolar === true;
  const centerPercent = showCenterTick ? ((((min + max) / 2) - min) / (max - min)) * 100 : 0;
  return (
    <label className="dp-mini-primary__slider">
      <span className="dp-mini-primary__slider-label">{schema.label}</span>
      <span className="dp-mini-primary__slider-input">
        {showCenterTick && (
          <span
            aria-hidden="true"
            className="dp-mini-primary__slider-tick"
            style={{ left: `${centerPercent}%` }}
          />
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={schema.label}
        />
      </span>
      <span className="dp-mini-primary__slider-value">{value.toFixed(decimals)}</span>
    </label>
  );
}
