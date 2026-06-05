import type { ViewMode } from '../types';
import { useI18n } from '../i18n/LanguageProvider';

interface ViewModeTabsProps {
  /** 現在の操作モード */
  viewMode: ViewMode;
  /** モード切替ハンドラ */
  onViewModeChange: (mode: ViewMode) => void;
  disabled?: boolean;
  /** 親コンテナ（ViewModeCard）の枠に内包する場合 true。自前の border/padding を外しボタン列だけ描画。 */
  bare?: boolean;
}

/**
 * 操作モード（視差ビュー / 3D ビュー）の最上位タブ。操作の意味がエフェクト間で異なる軸なので
 * EffectType から分離し ViewMode 軸として最上位に置く。
 */
export function ViewModeTabs({
  viewMode,
  onViewModeChange,
  disabled = false,
  bare = false,
}: ViewModeTabsProps) {
  const { t } = useI18n();
  const items: { mode: ViewMode; label: string }[] = [
    { mode: 'parallax', label: t.viewMode.parallax },
    { mode: 'orbit', label: t.viewMode.orbit },
  ];

  return (
    <div
      role="tablist"
      aria-label={t.viewMode.aria}
      style={
        bare
          ? { display: 'flex', gap: '0.4rem' }
          : {
              display: 'flex',
              gap: '0.4rem',
              padding: '0.5rem 0.75rem',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
            }
      }
    >
      {items.map(({ mode, label }) => {
        const selected = viewMode === mode;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onViewModeChange(mode)}
            style={{
              flex: '1 1 0',
              padding: '0.45rem 0.75rem',
              borderRadius: '6px',
              border: selected
                ? '1px solid rgba(120, 170, 255, 0.8)'
                : '1px solid rgba(255, 255, 255, 0.15)',
              background: selected
                ? 'rgba(120, 170, 255, 0.22)'
                : 'rgba(255, 255, 255, 0.04)',
              color: selected ? '#dde7ff' : '#cfd6e0',
              fontSize: '0.9rem',
              fontWeight: selected ? 600 : 400,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
