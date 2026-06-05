/**
 * 双極スライダー。min/max が符号を跨ぐパラメータ（dollyAmount -1..+1）専用。中央=中立（効果オフ）を
 * 視覚化するため中央ティックをオーバーレイし、ハンドルが中央 ±step に来たら 0 へ吸着する。
 * ネイティブ <input type="range"> を使い PointerEvent 経路は OS 任せ（CLAUDE.md: PointerEvent 統一）。
 * 値ラベルは bipolarLabels 指定時のみ方向語を併記、未指定なら符号のみ。
 */

interface BipolarSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** 方向ラベル（例: { negative: '広角', positive: '望遠' }）。 未指定なら符号のみ */
  bipolarLabels?: { negative: string; positive: string };
  onChange: (v: number) => void;
  disabled?: boolean;
}

export function BipolarSlider({
  label,
  value,
  min,
  max,
  step,
  bipolarLabels,
  onChange,
  disabled,
}: BipolarSliderProps) {
  const center = (min + max) / 2;
  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;

  // 中央スナップ: ハンドルが ±step 以内なら center に強制
  const handleChange = (raw: number) => {
    const snapped = Math.abs(raw - center) <= step + 1e-9 ? center : raw;
    onChange(snapped);
  };

  // 中央ティックの track 上の位置（%）
  const centerPercent = ((center - min) / (max - min)) * 100;

  return (
    <label style={rowStyle}>
      <span style={rowLabelStyle}>
        <span>{label}</span>
        <span style={rowValueStyle}>{formatBipolarValue(value, center, decimals, bipolarLabels)}</span>
      </span>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${centerPercent}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 2,
            height: 12,
            background: 'rgba(255, 255, 255, 0.45)',
            borderRadius: 1,
            pointerEvents: 'none',
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => handleChange(Number(e.target.value))}
          disabled={disabled}
          aria-label={label}
          style={{ flex: 1, width: '100%' }}
        />
      </div>
      {bipolarLabels && (
        <div style={endLabelRowStyle} aria-hidden="true">
          <span>{bipolarLabels.negative}</span>
          <span>{bipolarLabels.positive}</span>
        </div>
      )}
    </label>
  );
}

function formatBipolarValue(
  value: number,
  center: number,
  decimals: number,
  bipolarLabels: { negative: string; positive: string } | undefined,
): string {
  const delta = value - center;
  // 表示上の「中央」判定は浮動小数誤差を吸収するため小さな閾値で
  if (Math.abs(delta) < Math.pow(10, -decimals) / 2) {
    return '±0';
  }
  const sign = delta > 0 ? '+' : '-';
  const magnitude = Math.abs(delta).toFixed(decimals);
  if (!bipolarLabels) return `${sign}${magnitude}`;
  const dir = delta > 0 ? bipolarLabels.positive : bipolarLabels.negative;
  return `${sign}${magnitude} ${dir}`;
}

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

const endLabelRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '0.7rem',
  color: '#7d8694',
  marginTop: '-0.1rem',
};
