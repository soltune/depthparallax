import { EffectPanel } from './EffectPanel';
import { useI18n } from '../i18n/LanguageProvider';
import { DollyPlayControl } from './DollyPlayControl';
import { FocalDepthControl } from './FocalDepthControl';
import { ViewModeCard } from './ViewModeCard';
import { ImagePicker } from './ImagePicker';
import type { SampleItem } from './Dropzone';
import type {
  EffectDescriptor,
  EffectType,
  ParallaxConfig,
  ViewMode,
} from '../types';

type ParamValue = number | number[] | boolean;
type ParamMap = Record<string, ParamValue>;

/**
 * 設定 UI 全体を束ねる presentational コンテナ（配置は App.tsx + index.css の dp-viewer--wide / --sheet が担う）。
 * 画像 → ビュー → エフェクトの順: ImagePicker（推論完了で auto collapse）/ ViewModeCard /
 * 視差ビュー時 EffectPanel（dolly 選択時は headerSlot に DollyPlayControl）/ 末尾に深度マップ表示・強調トグル。
 */
export interface SettingsPaneProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;

  effects: readonly EffectDescriptor[];
  currentEffect: EffectType;
  onEffectChange: (type: EffectType) => void;
  currentParams: ParamMap;
  onParamsChange: (params: ParamMap) => void;
  disabledParams?: ReadonlySet<string>;
  syncToken?: number;

  parallaxConfig: ParallaxConfig;
  onConfigChange: (patch: Partial<ParallaxConfig>) => void;
  hasGyro: boolean;
  onToggleGyro: () => void;
  showDepthPreview: boolean;
  onToggleDepthPreview: () => void;
  /** 深度コントラスト強調（CDF）の切替。バイモーダル分布でクラスタ内の凹凸を均等展開する。 */
  enhanceDepth: boolean;
  onToggleEnhanceDepth: () => void;

  // 画像セクション
  samples: SampleItem[];
  onSelectFile: (file: File) => void;
  onSelectSample: (path: string) => void;
  imagePickerDisabled?: boolean;
  enableCameraCapture?: boolean;
  /** ImagePicker の auto-collapse トリガ。 通常は lastResult を渡す */
  imagePickerCollapseKey?: unknown;
  /** collapsed バーに表示する現在画像のサムネ URL */
  currentThumbnailUrl?: string | null;

  orbitParams: ParamMap;
  onOrbitParamsChange: (params: ParamMap) => void;

  isDollyPlaying: boolean;
  dollyProgress: number;
  onDollyPlay: () => void;
  onDollyStop: () => void;

  /** 焦点深度。dolly 選択時のみ headerSlot 内 FocalDepthControl（自動ボタン＋常時可動スライダー）で扱う。 */
  dollyFocalAuto: boolean;
  dollyFocalDepth: number;
  onDollyFocalAutoChange: (auto: boolean) => void;
  onDollyFocalDepthChange: (depth: number) => void;

  /** dof / tiltshift の焦点深度自動化（パラメータ名は両者共通）。dolly と同じ FocalDepthControl を headerSlot に流用。 */
  filterFocalAuto: boolean;
  filterFocalDepth: number;
  onFilterFocalAutoChange: (auto: boolean) => void;
  onFilterFocalDepthChange: (depth: number) => void;
}

/** dolly 選択時に EffectPanel.hiddenParams へ渡す名前集合（params grid から外す）。 */
const DOLLY_FOCAL_HIDDEN: ReadonlySet<string> = new Set([
  'dollyFocalAuto',
  'dollyFocalDepth',
]);

/** dof / tiltshift 選択時に EffectPanel.hiddenParams へ渡す名前集合（params grid から外す）。 */
const FILTER_FOCAL_HIDDEN: ReadonlySet<string> = new Set(['focalAuto', 'focalDepth']);

export function SettingsPane({
  viewMode,
  onViewModeChange,
  effects,
  currentEffect,
  onEffectChange,
  currentParams,
  onParamsChange,
  disabledParams,
  syncToken,
  parallaxConfig,
  onConfigChange,
  hasGyro,
  onToggleGyro,
  showDepthPreview,
  onToggleDepthPreview,
  enhanceDepth,
  onToggleEnhanceDepth,
  samples,
  onSelectFile,
  onSelectSample,
  imagePickerDisabled,
  enableCameraCapture,
  imagePickerCollapseKey,
  currentThumbnailUrl,
  orbitParams,
  onOrbitParamsChange,
  isDollyPlaying,
  dollyProgress,
  onDollyPlay,
  onDollyStop,
  dollyFocalAuto,
  dollyFocalDepth,
  onDollyFocalAutoChange,
  onDollyFocalDepthChange,
  filterFocalAuto,
  filterFocalDepth,
  onFilterFocalAutoChange,
  onFilterFocalDepthChange,
}: SettingsPaneProps) {
  const { t } = useI18n();
  const isFilterFocalEffect = currentEffect === 'dof' || currentEffect === 'tiltshift';
  return (
    <div className="dp-settings-pane">
      <ImagePicker
        samples={samples}
        onSelectFile={onSelectFile}
        onSelectSample={onSelectSample}
        disabled={imagePickerDisabled}
        enableCameraCapture={enableCameraCapture}
        collapseKey={imagePickerCollapseKey}
        currentThumbnailUrl={currentThumbnailUrl}
      />
      <ViewModeCard
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        parallaxConfig={parallaxConfig}
        onConfigChange={onConfigChange}
        hasGyro={hasGyro}
        onToggleGyro={onToggleGyro}
        orbitParams={orbitParams}
        onOrbitParamsChange={onOrbitParamsChange}
      />
      {viewMode === 'parallax' && (
        <>
          <EffectPanel
            effects={effects}
            currentEffect={currentEffect}
            onEffectChange={onEffectChange}
            params={currentParams}
            onParamsChange={onParamsChange}
            disabledParams={disabledParams}
            hiddenParams={
              currentEffect === 'dolly'
                ? DOLLY_FOCAL_HIDDEN
                : isFilterFocalEffect
                  ? FILTER_FOCAL_HIDDEN
                  : undefined
            }
            syncToken={syncToken}
            headerSlot={
              currentEffect === 'dolly' ? (
                <>
                  <DollyPlayControl
                    playing={isDollyPlaying}
                    progress={dollyProgress}
                    onPlay={onDollyPlay}
                    onStop={onDollyStop}
                  />
                  <FocalDepthControl
                    auto={dollyFocalAuto}
                    focalDepth={dollyFocalDepth}
                    onAutoChange={onDollyFocalAutoChange}
                    onDepthChange={onDollyFocalDepthChange}
                  />
                </>
              ) : isFilterFocalEffect ? (
                <FocalDepthControl
                  auto={filterFocalAuto}
                  focalDepth={filterFocalDepth}
                  onAutoChange={onFilterFocalAutoChange}
                  onDepthChange={onFilterFocalDepthChange}
                  step={0.01}
                />
              ) : undefined
            }
          />
        </>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
          padding: '0.5rem 0.25rem 0',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          marginTop: '0.25rem',
        }}
      >
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.8rem',
            color: '#9aa3b2',
          }}
        >
          <input
            type="checkbox"
            checked={showDepthPreview}
            onChange={onToggleDepthPreview}
          />
          {t.depthMap.showToggle}
        </label>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.8rem',
            color: '#9aa3b2',
          }}
          title={t.depthMap.enhanceTooltip}
        >
          <input
            type="checkbox"
            checked={enhanceDepth}
            onChange={onToggleEnhanceDepth}
          />
          {t.depthMap.enhanceToggle}
        </label>
      </div>
    </div>
  );
}
