/**
 * Dolly Zoom 自動再生コントロール。dolly 選択時のみ EffectPanel の headerSlot に差し込まれる。
 * 配色・ボタン形状は AutoRotateButton と揃え、進行を progress バーで可視化。停止時の
 * dollyAmount=0 リセットは App 側（onStop）が持つ。
 */

import { useI18n } from '../i18n/LanguageProvider';

interface DollyPlayControlProps {
  /** 自動再生中フラグ */
  playing: boolean;
  /** 0.0〜1.0 の進行率 */
  progress: number;
  onPlay: () => void;
  onStop: () => void;
  disabled?: boolean;
}

export function DollyPlayControl({
  playing,
  progress,
  onPlay,
  onStop,
  disabled = false,
}: DollyPlayControlProps) {
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
      <span style={{ flexShrink: 0 }}>{t.dolly.autoplay}</span>
      <progress
        value={playing ? progress : 0}
        max={1}
        aria-label={t.dolly.progressAria}
        style={{
          flex: 1,
          minWidth: 80,
          height: '0.65rem',
          opacity: playing ? 1 : 0.4,
        }}
      />
      <button
        type="button"
        onClick={playing ? onStop : onPlay}
        disabled={disabled}
        aria-label={playing ? t.common.stop : t.common.play}
        aria-pressed={playing}
        style={{
          flexShrink: 0,
          touchAction: 'manipulation',
        }}
      >
        {playing ? t.common.stopButton : t.common.playButton}
      </button>
    </div>
  );
}
