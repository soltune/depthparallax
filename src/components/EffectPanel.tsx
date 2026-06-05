import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  EffectDescriptor,
  EffectGroup,
  EffectParamSchema,
  EffectType,
} from '../types';
import { BipolarSlider } from './BipolarSlider';
import { useI18n } from '../i18n/LanguageProvider';

type ParamValue = number | number[] | boolean;
type ParamMap = Record<string, ParamValue>;

interface EffectPanelProps {
  /** 利用可能なエフェクト一覧（EffectRenderer.getAvailableEffects() の結果） */
  effects: readonly EffectDescriptor[];
  /** 現在選択中のエフェクト */
  currentEffect: EffectType;
  /** エフェクト切り替えハンドラ */
  onEffectChange: (type: EffectType) => void;
  /** 現在のエフェクトのパラメータ値 */
  params: ParamMap;
  /** パラメータ更新ハンドラ。rAF throttle 経由で 1 フレーム 1 回呼ばれる */
  onParamsChange: (params: ParamMap) => void;
  disabled?: boolean;
  /** 個別パラメータの disable 集合（Dolly 自動再生中の dollyAmount のように親が外部書き込みする値）。 */
  disabledParams?: ReadonlySet<string>;
  /**
   * 描画スキップ集合。dolly の dollyFocalAuto / dollyFocalDepth のように uniform 経路は維持しつつ
   * UI を専用コンポーネント（FocalDepthControl）に外注するパラメータを grid から抑止する（descriptor は不変）。
   */
  hiddenParams?: ReadonlySet<string>;
  /**
   * 親が params を外部書き換えした時に bump する単調増加トークン。通常のスライダー入力は自分発の echo なので
   * resync しないが、Dolly 自動再生終了や焦点深度自動取得時はこれを進めて localParams を強制再同期する。
   */
  syncToken?: number;
  /** パラメータ群の上に差し込むスロット（Dolly の DollyPlayControl を同じ枠に同居させる用、UI 統一）。 */
  headerSlot?: ReactNode;
}

function defaultsFor(desc: EffectDescriptor): ParamMap {
  const m: ParamMap = {};
  for (const p of desc.params) m[p.name] = p.default;
  return m;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function vec3ToHex(v: number[]): string {
  const r = Math.round(clamp01(v[0] ?? 0) * 255);
  const g = Math.round(clamp01(v[1] ?? 0) * 255);
  const b = Math.round(clamp01(v[2] ?? 0) * 255);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function hexToVec3(hex: string): number[] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** 名前に color を含む vec3 はカラーピッカーで扱う（言語非依存な param 名で判定。対象 fog.fogColor / neon.glowColor）。 */
function isColorParam(p: EffectParamSchema): boolean {
  return p.type === 'vec3' && /color/i.test(p.name);
}

const GROUP_ORDER: readonly EffectGroup[] = ['filter', 'motion'];

export function EffectPanel({
  effects,
  currentEffect,
  onEffectChange,
  params,
  onParamsChange,
  disabled = false,
  disabledParams,
  hiddenParams,
  syncToken,
  headerSlot,
}: EffectPanelProps) {
  const { t } = useI18n();
  const groupLabel = (group: EffectGroup) =>
    group === 'filter' ? t.effectPanel.groupFilter : t.effectPanel.groupMotion;
  // タブラベル。parallax だけタブ上では「エフェクトなし」と読み替える（内部識別子はそのまま）。
  const tabLabelFor = (desc: EffectDescriptor) =>
    desc.type === 'parallax' ? t.effectPanel.noEffect : desc.displayName;

  const currentDesc = useMemo(
    () => effects.find((e) => e.type === currentEffect),
    [effects, currentEffect],
  );

  // group ごとに effects を分割（descriptor 配列の元順序を保つ）。
  const groupedEffects = useMemo(() => {
    const map = new Map<EffectGroup, EffectDescriptor[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const e of effects) {
      const list = map.get(e.group);
      if (list) list.push(e);
    }
    return map;
  }, [effects]);

  // 二段タブ: currentEffect が属するグループを Lv1 のアクティブグループとする。
  // currentEffect 変化に追従して自動切替（Lv2 タップ → Lv1 自動追従）。
  const activeGroup: EffectGroup = currentDesc?.group ?? GROUP_ORDER[0];

  // 各グループで最後に選んだエフェクトを保持し、Lv1 タブで他グループへ切替えた際に前回選択を復元する。
  const [lastEffectPerGroup, setLastEffectPerGroup] = useState<
    Record<EffectGroup, EffectType | null>
  >(() => {
    const init: Record<EffectGroup, EffectType | null> = { filter: null, motion: null };
    if (currentDesc) init[currentDesc.group] = currentDesc.type;
    return init;
  });
  useEffect(() => {
    if (!currentDesc) return;
    setLastEffectPerGroup((prev) =>
      prev[currentDesc.group] === currentDesc.type
        ? prev
        : { ...prev, [currentDesc.group]: currentDesc.type },
    );
  }, [currentDesc]);

  // activeGroup / currentEffect 変化時にアクティブな Lv2 タブを横スクロール内へ寄せる ref。
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = activeTabRef.current;
    if (!el) return;
    el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [activeGroup, currentEffect]);

  // Lv2 横スクロールの overflow 検出。右端 gradient だけでは押せると伝わらないため、overflow がある側に
  // chevron ボタンを出す（マウスで右端タブに辿り着けない問題への対策）。
  const lv2ScrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollHints, setScrollHints] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });
  useEffect(() => {
    const el = lv2ScrollRef.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setScrollHints((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
    // activeGroup 変化で Lv2 内のタブ要素数が変わる → scrollWidth が変わる ので再計測。
  }, [activeGroup]);

  const scrollLv2By = useCallback((dir: -1 | 1) => {
    const el = lv2ScrollRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.max(120, el.clientWidth * 0.7),
      behavior: 'smooth',
    });
  }, []);

  const handleGroupTabClick = useCallback(
    (group: EffectGroup) => {
      if (group === activeGroup) return;
      const list = groupedEffects.get(group) ?? [];
      const last = lastEffectPerGroup[group];
      const target = last && list.some((e) => e.type === last) ? last : list[0]?.type;
      if (target && target !== currentEffect) onEffectChange(target);
    },
    [activeGroup, groupedEffects, lastEffectPerGroup, currentEffect, onEffectChange],
  );

  // ローカル state（スライダー操作中の表示値）。親 state は rAF throttle で反映。
  const [localParams, setLocalParams] = useState<ParamMap>(params);
  const localParamsRef = useRef<ParamMap>(params);
  localParamsRef.current = localParams;

  // currentEffect 切替で親の新 params を同期。パラメータ変更のみ（currentEffect 不変）は自分発の echo なので
  // 同期不要だが、親が外部書き換えする時は syncToken を bump して強制再同期する。
  useEffect(() => {
    setLocalParams(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEffect, syncToken]);

  // rAF throttle: pending を rAF コールバックで flush。
  const pendingRef = useRef<ParamMap | null>(null);
  const rafRef = useRef<number | null>(null);
  const onParamsChangeRef = useRef(onParamsChange);
  onParamsChangeRef.current = onParamsChange;

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next) onParamsChangeRef.current(next);
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
    (name: string, value: ParamValue) => {
      const next = { ...localParamsRef.current, [name]: value };
      setLocalParams(next);
      // hidden 経路で親が単独管理するパラメータ（dollyFocalAuto 等）は pending から除外する。
      // 除外しないと FocalDepthControl 経由の親更新を、次の rAF flush で古い localParams が上書きしてしまう。
      let payload: ParamMap = next;
      if (hiddenParams && hiddenParams.size > 0) {
        payload = {};
        for (const k in next) {
          if (!hiddenParams.has(k)) payload[k] = next[k];
        }
      }
      pendingRef.current = payload;
      scheduleFlush();
    },
    [scheduleFlush, hiddenParams],
  );

  const handleReset = useCallback(() => {
    if (!currentDesc) return;
    const defaults = defaultsFor(currentDesc);
    setLocalParams(defaults);
    pendingRef.current = defaults;
    scheduleFlush();
  }, [currentDesc, scheduleFlush]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '0.75rem 1rem',
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '8px',
      }}
    >
      <div
        role="tablist"
        aria-label={t.effectPanel.groupsAria}
        style={{
          display: 'flex',
          gap: '0.4rem',
        }}
      >
        {GROUP_ORDER.map((group) => {
          const items = groupedEffects.get(group) ?? [];
          if (items.length === 0) return null;
          const selected = group === activeGroup;
          return (
            <button
              key={group}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => handleGroupTabClick(group)}
              style={{
                flex: 1,
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: selected
                  ? '1px solid rgba(120, 170, 255, 0.8)'
                  : '1px solid rgba(255, 255, 255, 0.15)',
                background: selected
                  ? 'rgba(120, 170, 255, 0.18)'
                  : 'rgba(255, 255, 255, 0.04)',
                color: selected ? '#dde7ff' : '#cfd6e0',
                fontSize: '0.9rem',
                fontWeight: selected ? 600 : 400,
                cursor: disabled ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                touchAction: 'manipulation',
              }}
            >
              {groupLabel(group)}
            </button>
          );
        })}
      </div>

      <div style={lv2WrapStyle}>
        <div
          ref={lv2ScrollRef}
          role="tablist"
          aria-label={groupLabel(activeGroup)}
          style={lv2ScrollStyle}
          className="dp-lv2-scroll"
        >
          {(groupedEffects.get(activeGroup) ?? []).map((e) => {
            const selected = currentEffect === e.type;
            return (
              <button
                key={e.type}
                ref={selected ? activeTabRef : undefined}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                disabled={disabled}
                onClick={() => onEffectChange(e.type)}
                style={{
                  flexShrink: 0,
                  scrollSnapAlign: 'start',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  border: selected
                    ? '1px solid rgba(120, 170, 255, 0.8)'
                    : '1px solid rgba(255, 255, 255, 0.15)',
                  background: selected
                    ? 'rgba(120, 170, 255, 0.18)'
                    : 'rgba(255, 255, 255, 0.04)',
                  color: selected ? '#dde7ff' : '#cfd6e0',
                  fontSize: '0.85rem',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                  touchAction: 'manipulation',
                }}
              >
                {tabLabelFor(e)}
              </button>
            );
          })}
        </div>
        {scrollHints.left && (
          <>
            <div aria-hidden style={lv2EdgeMaskLeftStyle} />
            <button
              type="button"
              aria-label={t.effectPanel.scrollLeft}
              onClick={() => scrollLv2By(-1)}
              className="dp-lv2-chevron"
              style={{ ...lv2ChevronStyle, left: 0 }}
            >
              ‹
            </button>
          </>
        )}
        {scrollHints.right && (
          <>
            <div aria-hidden style={lv2EdgeMaskRightStyle} />
            <button
              type="button"
              aria-label={t.effectPanel.scrollRight}
              onClick={() => scrollLv2By(1)}
              className="dp-lv2-chevron"
              style={{ ...lv2ChevronStyle, right: 0 }}
            >
              ›
            </button>
          </>
        )}
      </div>

      {currentDesc && (
        <div
          role="tabpanel"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
        >
          {headerSlot}
          {currentDesc.params.length === 0 ? (
            <p
              style={{
                margin: 0,
                fontSize: '0.85rem',
                color: '#9aa3b2',
              }}
            >
              {t.effectPanel.noParams}
            </p>
          ) : (
            <>
              <div
                id="dp-effect-params"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '0.6rem 1.25rem',
                }}
              >
                {currentDesc.params.map((p) => {
                  if (hiddenParams?.has(p.name)) return null;
                  return (
                    <ParamControl
                      key={p.name}
                      schema={p}
                      value={localParams[p.name] ?? p.default}
                      onChange={(v) => handleChange(p.name, v)}
                      disabled={disabled || disabledParams?.has(p.name)}
                    />
                  );
                })}
              </div>
              <div>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={disabled}
                  style={{
                    fontSize: '0.8rem',
                    background: 'transparent',
                    border: 'none',
                    color: '#80a7ff',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  {t.effectPanel.reset}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface ParamControlProps {
  schema: EffectParamSchema;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
  disabled?: boolean;
}

export function ParamControl({ schema, value, onChange, disabled }: ParamControlProps) {
  if (schema.type === 'float') {
    const v = typeof value === 'number' ? value : (schema.default as number);
    if (schema.bipolar) {
      return (
        <BipolarSlider
          label={schema.label}
          value={v}
          min={schema.min ?? -1}
          max={schema.max ?? 1}
          step={schema.step ?? 0.01}
          bipolarLabels={schema.bipolarLabels}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }
    return (
      <FloatRow
        label={schema.label}
        value={v}
        min={schema.min ?? 0}
        max={schema.max ?? 1}
        step={schema.step ?? 0.01}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  if (schema.type === 'enum') {
    const v = typeof value === 'number' ? value : (schema.default as number);
    return (
      <EnumRow
        label={schema.label}
        value={v}
        options={schema.options ?? []}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  if (schema.type === 'bool') {
    const v = typeof value === 'boolean' ? value : (schema.default as boolean);
    return (
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          fontSize: '0.85rem',
          color: '#cfd6e0',
        }}
      >
        <input
          type="checkbox"
          checked={v}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-label={schema.label}
        />
        {schema.label}
      </label>
    );
  }
  if (schema.type === 'vec3') {
    const v = Array.isArray(value) ? value : (schema.default as number[]);
    if (isColorParam(schema)) {
      return (
        <ColorRow
          label={schema.label}
          value={v}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }
    return (
      <Vec3Row
        label={schema.label}
        value={v}
        min={schema.min ?? 0}
        max={schema.max ?? 1}
        step={schema.step ?? 0.01}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  // vec2 等は未使用なので簡易フォールバック
  return null;
}

interface FloatRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

function FloatRow({ label, value, min, max, step, onChange, disabled }: FloatRowProps) {
  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  return (
    <label style={rowStyle}>
      <span style={rowLabelStyle}>
        <span>{label}</span>
        <span style={rowValueStyle}>{value.toFixed(decimals)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label={label}
      />
    </label>
  );
}

interface EnumRowProps {
  label: string;
  value: number;
  options: ReadonlyArray<{ value: number; label: string }>;
  onChange: (v: number) => void;
  disabled?: boolean;
}

function EnumRow({ label, value, options, onChange, disabled }: EnumRowProps) {
  return (
    <div role="group" aria-label={label} style={rowStyle}>
      <span style={{ ...rowLabelStyle, color: '#cfd6e0' }}>
        <span>{label}</span>
      </span>
      <div style={enumGroupStyle}>
        {options.map((opt, i) => {
          const selected = opt.value === value;
          const isFirst = i === 0;
          const isLast = i === options.length - 1;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                if (!selected) onChange(opt.value);
              }}
              disabled={disabled}
              aria-pressed={selected}
              style={{
                ...enumButtonStyle,
                borderTopLeftRadius: isFirst ? 6 : 0,
                borderBottomLeftRadius: isFirst ? 6 : 0,
                borderTopRightRadius: isLast ? 6 : 0,
                borderBottomRightRadius: isLast ? 6 : 0,
                borderLeftWidth: isFirst ? 1 : 0,
                background: selected ? 'rgba(128,167,255,0.22)' : 'transparent',
                color: selected ? '#dde7ff' : '#cfd6e0',
                cursor: disabled ? 'not-allowed' : selected ? 'default' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const enumGroupStyle: React.CSSProperties = {
  display: 'flex',
  width: '100%',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  overflow: 'hidden',
};

const enumButtonStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '0.4rem 0.3rem',
  fontSize: '0.8rem',
  lineHeight: 1.2,
  borderTop: 'none',
  borderRight: 'none',
  borderBottom: 'none',
  borderLeft: '1px solid rgba(255,255,255,0.15)',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  touchAction: 'manipulation',
};

interface ColorRowProps {
  label: string;
  value: number[];
  onChange: (v: number[]) => void;
  disabled?: boolean;
}

function ColorRow({ label, value, onChange, disabled }: ColorRowProps) {
  const hex = vec3ToHex(value);
  return (
    <label style={rowStyle}>
      <span style={rowLabelStyle}>
        <span>{label}</span>
        <span style={rowValueStyle}>{hex.toUpperCase()}</span>
      </span>
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(hexToVec3(e.target.value))}
        disabled={disabled}
        aria-label={label}
        style={{
          width: '100%',
          height: '2rem',
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      />
    </label>
  );
}

interface Vec3RowProps {
  label: string;
  value: number[];
  min: number;
  max: number;
  step: number;
  onChange: (v: number[]) => void;
  disabled?: boolean;
}

function Vec3Row({ label, value, min, max, step, onChange, disabled }: Vec3RowProps) {
  return (
    <fieldset
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        border: 'none',
        padding: 0,
        margin: 0,
      }}
    >
      <legend style={{ ...rowValueStyle, color: '#cfd6e0', padding: 0 }}>{label}</legend>
      {['x', 'y', 'z'].map((axis, i) => (
        <input
          key={axis}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value[i] ?? 0}
          onChange={(e) => {
            const next = [...value];
            next[i] = Number(e.target.value);
            onChange(next);
          }}
          disabled={disabled}
          aria-label={`${label} ${axis}`}
        />
      ))}
    </fieldset>
  );
}

const lv2WrapStyle: React.CSSProperties = {
  position: 'relative',
};

const lv2ScrollStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.4rem',
  overflowX: 'auto',
  overflowY: 'hidden',
  scrollSnapType: 'x proximity',
  scrollbarWidth: 'thin',
  WebkitOverflowScrolling: 'touch',
  paddingBottom: '0.1rem',
};

const lv2EdgeMaskRightStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: '36px',
  pointerEvents: 'none',
  background:
    'linear-gradient(to right, rgba(20,22,28,0) 0%, rgba(20,22,28,0.85) 100%)',
};

const lv2EdgeMaskLeftStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  width: '36px',
  pointerEvents: 'none',
  background:
    'linear-gradient(to left, rgba(20,22,28,0) 0%, rgba(20,22,28,0.85) 100%)',
};

const lv2ChevronStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  width: '24px',
  height: '24px',
  padding: 0,
  borderRadius: '50%',
  border: '1px solid rgba(255, 255, 255, 0.22)',
  background: 'rgba(20, 22, 28, 0.92)',
  color: '#dde7ff',
  fontSize: '1rem',
  lineHeight: 1,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'manipulation',
  zIndex: 1,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.85rem',
};

const rowLabelStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  color: '#cfd6e0',
};

const rowValueStyle: React.CSSProperties = {
  color: '#9aa3b2',
  fontVariantNumeric: 'tabular-nums',
};
