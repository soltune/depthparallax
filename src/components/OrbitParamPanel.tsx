import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ParamControl } from './EffectPanel';
import { ORBIT_PARAM_SCHEMA } from '../viewModes/orbit';
import { useI18n } from '../i18n/LanguageProvider';
import { localizeParamSchema } from '../i18n/localizeEffects';

type ParamValue = number | number[] | boolean;
type ParamMap = Record<string, ParamValue>;

interface OrbitParamPanelProps {
  /** orbit パラメータの現在値（depthScale / autoRotate） */
  params: ParamMap;
  /** パラメータ更新ハンドラ。 rAF throttle 経由で 1 フレーム 1 回呼ばれる */
  onParamsChange: (params: ParamMap) => void;
  disabled?: boolean;
  /** 親コンテナ（ViewModeCard）の枠に内包する場合 true。自前の border/padding を外しフォーム列だけ描画。 */
  bare?: boolean;
}

/**
 * 3D ビュー用パラメータパネル。EffectPanel の ParamControl を流用した薄いラッパ（タブ・reset なし）。
 * ORBIT_PARAM_SCHEMA を並べ、onParamsChange は EffectPanel と同じく rAF throttle で 1 フレーム 1 回。
 */
export function OrbitParamPanel({
  params,
  onParamsChange,
  disabled = false,
  bare = false,
}: OrbitParamPanelProps) {
  const { t } = useI18n();
  const schema = useMemo(
    () => localizeParamSchema(ORBIT_PARAM_SCHEMA, t.orbit.params),
    [t],
  );
  const [localParams, setLocalParams] = useState<ParamMap>(params);
  const localParamsRef = useRef<ParamMap>(params);
  localParamsRef.current = localParams;

  // 親 props の変化に追随（自分発の echo は setState 同値で no-op）。
  useEffect(() => {
    setLocalParams(params);
  }, [params]);

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
      pendingRef.current = next;
      scheduleFlush();
    },
    [scheduleFlush],
  );

  return (
    <div
      style={
        bare
          ? { display: 'flex', flexDirection: 'column', gap: '0.75rem' }
          : {
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
            }
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '0.6rem 1.25rem',
        }}
      >
        {schema.filter((p) => p.name !== 'autoRotate').map((p) => (
          <ParamControl
            key={p.name}
            schema={p}
            value={localParams[p.name] ?? p.default}
            onChange={(v) => handleChange(p.name, v)}
            disabled={disabled}
          />
        ))}
      </div>
      <AutoRotateButton
        playing={Boolean(localParams.autoRotate)}
        onToggle={() => handleChange('autoRotate', !localParams.autoRotate)}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * 自動回転の再生/停止ボタン。bool パラメータ autoRotate を ON/OFF でなく時間制御（▶/⏸）として提示する
 * （配色は DollyPlayControl と揃え、orbit は無限ループのため progress バーなし）。
 */
function AutoRotateButton({
  playing,
  onToggle,
  disabled,
}: {
  playing: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.6rem 1rem',
        background: 'rgba(120, 170, 255, 0.08)',
        border: '1px solid rgba(120, 170, 255, 0.25)',
        borderRadius: '8px',
        fontSize: '0.85rem',
        color: '#dde7ff',
      }}
    >
      <span style={{ flexShrink: 0 }}>{t.orbit.autoRotateLabel}</span>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={playing ? t.common.stop : t.common.play}
        aria-pressed={playing}
        style={{
          marginLeft: 'auto',
          flexShrink: 0,
          touchAction: 'manipulation',
        }}
      >
        {playing ? t.common.stopButton : t.common.playButton}
      </button>
    </div>
  );
}
