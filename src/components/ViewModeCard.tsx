import { ControlBar } from './ControlBar';
import { OrbitParamPanel } from './OrbitParamPanel';
import { ViewModeTabs } from './ViewModeTabs';
import type { ParallaxConfig, ViewMode } from '../types';

type ParamValue = number | number[] | boolean;
type ParamMap = Record<string, ParamValue>;

interface ViewModeCardProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;

  // 視差ビュー用
  parallaxConfig: ParallaxConfig;
  onConfigChange: (patch: Partial<ParallaxConfig>) => void;
  hasGyro: boolean;
  onToggleGyro: () => void;

  // 3D ビュー用
  orbitParams: ParamMap;
  onOrbitParamsChange: (params: ParamMap) => void;

  disabled?: boolean;
}

/**
 * ビューモードタブとモード固有パラメータを 1 枠に統合するカード。EffectPanel と同じ装飾値で
 * 「タブと中身が組のカード」として描く。中身は viewMode で切替（視差 → ControlBar / 3D → OrbitParamPanel）。
 * 各子に bare=true を渡し外枠装飾は親 div に一本化する。
 */
export function ViewModeCard({
  viewMode,
  onViewModeChange,
  parallaxConfig,
  onConfigChange,
  hasGyro,
  onToggleGyro,
  orbitParams,
  onOrbitParamsChange,
  disabled = false,
}: ViewModeCardProps) {
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
      <ViewModeTabs
        bare
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        disabled={disabled}
      />
      {viewMode === 'parallax' && (
        <ControlBar
          bare
          config={parallaxConfig}
          onChange={onConfigChange}
          hasGyro={hasGyro}
          onToggleGyro={onToggleGyro}
          disabled={disabled}
        />
      )}
      {viewMode === 'orbit' && (
        <OrbitParamPanel
          bare
          params={orbitParams}
          onParamsChange={onOrbitParamsChange}
          disabled={disabled}
        />
      )}
    </div>
  );
}
