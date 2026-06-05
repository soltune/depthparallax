import type { ParallaxConfig } from '../types';
import { ToggleSwitch } from './ToggleSwitch';
import { useI18n } from '../i18n/LanguageProvider';

/**
 * 視差ビュー専用の設定バー（視差パラメータのスライダー群 + 方向反転 / ジャイロ）。
 * 3D ビュー時は描画されない。ViewModeCard の枠に内包される（bare プロップ）。
 */
interface ControlBarProps {
  config: ParallaxConfig;
  onChange: (patch: Partial<ParallaxConfig>) => void;
  hasGyro: boolean;
  /** ジャイロ有効化のため iOS 等の許可ダイアログをユーザータップ起点で呼ぶ */
  onToggleGyro: () => void;
  disabled?: boolean;
  /** 親コンテナ（ViewModeCard）の枠に内包する場合 true。自前の border/padding を外し grid だけ描画。 */
  bare?: boolean;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}

function SliderRow({ label, value, min, max, step, onChange, format, disabled }: SliderRowProps) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        fontSize: '0.85rem',
      }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', color: '#cfd6e0' }}>
        <span>{label}</span>
        <span style={{ color: '#9aa3b2', fontVariantNumeric: 'tabular-nums' }}>
          {format ? format(value) : value.toString()}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
    </label>
  );
}

export function ControlBar({
  config,
  onChange,
  hasGyro,
  onToggleGyro,
  disabled = false,
  bare = false,
}: ControlBarProps) {
  const { t } = useI18n();
  return (
    <div
      style={
        bare
          ? {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem 1.25rem',
            }
          : {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem 1.25rem',
              padding: '0.75rem 1rem',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
            }
      }
    >
      <SliderRow
        label={t.controlBar.strength}
        value={config.maxDisplacement}
        min={0}
        max={100}
        step={1}
        onChange={(v) => onChange({ maxDisplacement: v })}
        format={(v) => `${v}px`}
        disabled={disabled}
      />
      {hasGyro && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ToggleSwitch
            label={t.controlBar.gyro}
            checked={config.useGyro}
            onChange={() => onToggleGyro()}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
