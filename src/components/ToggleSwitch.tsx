/**
 * 汎用トグルスイッチ。状態(ON/OFF)をつまみ位置で常時可視化する（動詞ラベル切替ボタンの代替）。
 * <button role="switch" aria-checked> 実装でキーボード(Space/Enter)とタップを OS 挙動に委ねる（PointerEvent 維持）。
 */

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

const TRACK_WIDTH = 36;
const TRACK_HEIGHT = 20;
const THUMB_SIZE = 16;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - 2; // 左右の 1px パディング分を引く

export function ToggleSwitch({ checked, onChange, label, disabled = false }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.6rem',
        padding: '0.45rem 0.75rem',
        borderRadius: '6px',
        border: checked
          ? '1px solid rgba(120, 170, 255, 0.55)'
          : '1px solid rgba(255, 255, 255, 0.15)',
        background: checked
          ? 'rgba(120, 170, 255, 0.12)'
          : 'rgba(255, 255, 255, 0.04)',
        color: '#cfd6e0',
        fontSize: '0.85rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        touchAction: 'manipulation',
        transition: 'background 150ms ease, border-color 150ms ease',
      }}
    >
      <span>{label}</span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'relative',
            width: TRACK_WIDTH,
            height: TRACK_HEIGHT,
            borderRadius: 999,
            background: checked
              ? 'rgba(120, 170, 255, 0.55)'
              : 'rgba(255, 255, 255, 0.15)',
            border: checked
              ? '1px solid rgba(120, 170, 255, 0.8)'
              : '1px solid rgba(255, 255, 255, 0.25)',
            transition: 'background 150ms ease, border-color 150ms ease',
            flexShrink: 0,
            boxSizing: 'border-box',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: '50%',
              left: 1,
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              marginTop: -THUMB_SIZE / 2,
              borderRadius: '50%',
              background: '#fff',
              transform: checked ? `translateX(${THUMB_TRAVEL}px)` : 'translateX(0)',
              transition: 'transform 150ms ease',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
            }}
          />
        </span>
        <span
          style={{
            color: checked ? '#dde7ff' : '#9aa3b2',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: checked ? 600 : 400,
            minWidth: '2.2em',
            textAlign: 'left',
          }}
        >
          {checked ? 'ON' : 'OFF'}
        </span>
      </span>
    </button>
  );
}
