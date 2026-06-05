/**
 * 焦点深度コントロール。スライダーは常時可動で、隣の「自動」ボタンは中央 depth を計測した位置へ戻す
 * リセットアクション。EffectPanel の headerSlot で dolly / dof / tiltshift 選択時に差し込まれ、
 * 同時に hiddenParams で素のスライダー描画を抑止する。
 * `auto` は「現在スライダー値が自動計測値に追従中か」を示す内部状態で、ボタンの点灯（状態インジケータ）と
 * 画像切替時の自動追従判定に使う。スライダーを手で動かすと親が `auto=false` に倒す。
 */

import { useI18n } from '../i18n/LanguageProvider';

interface FocalDepthControlProps {
  /** 自動計測値に追従中か。ボタンの点灯（状態インジケータ）と画像切替時の追従判定に使う内部状態。 */
  auto: boolean;
  /** 現在の焦点深度（0..1） */
  focalDepth: number;
  /** 「自動」ボタン押下ハンドラ。中央 depth を再計測して focalDepth をリセットさせる（常に true で呼ぶ）。 */
  onAutoChange: (auto: boolean) => void;
  /** スライダー操作ハンドラ。親側で同時に auto=false へ倒す。 */
  onDepthChange: (depth: number) => void;
  /** 手動スライダーの step（エフェクト記述子に合わせる。Dolly 0.05 / DoF・Tilt-shift 0.01）。 */
  step?: number;
  disabled?: boolean;
}

export function FocalDepthControl({
  auto,
  focalDepth,
  onAutoChange,
  onDepthChange,
  step = 0.05,
  disabled = false,
}: FocalDepthControlProps) {
  const { t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t.focal.label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        padding: '0.6rem 1rem',
        background: 'rgba(120, 170, 255, 0.08)',
        border: '1px solid rgba(120, 170, 255, 0.25)',
        borderRadius: '8px',
        fontSize: '0.85rem',
        color: '#dde7ff',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <span>{t.focal.label}</span>
        <span style={{ color: '#9aa3b2', fontVariantNumeric: 'tabular-nums' }}>
          {focalDepth.toFixed(2)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <button
          type="button"
          onClick={() => onAutoChange(true)}
          disabled={disabled}
          aria-pressed={auto}
          title={t.focal.autoHint}
          style={{
            flexShrink: 0,
            padding: '0.4rem 0.7rem',
            fontSize: '0.8rem',
            lineHeight: 1.2,
            borderRadius: 6,
            border: auto
              ? '1px solid rgba(120, 170, 255, 0.8)'
              : '1px solid rgba(255, 255, 255, 0.15)',
            background: auto ? 'rgba(128, 167, 255, 0.22)' : 'transparent',
            color: auto ? '#dde7ff' : '#cfd6e0',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            whiteSpace: 'nowrap',
            touchAction: 'manipulation',
          }}
        >
          {t.focal.auto}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={step}
          value={focalDepth}
          onChange={(e) => onDepthChange(Number(e.target.value))}
          disabled={disabled}
          aria-label={t.focal.label}
          style={{
            flex: 1,
            minWidth: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
      </div>
    </div>
  );
}
