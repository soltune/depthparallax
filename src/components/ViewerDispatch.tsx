import type { DepthResult, EffectType, ParallaxConfig, ViewMode } from '../types';
import { EffectViewer } from './EffectViewer';
import { OrbitViewer } from './OrbitViewer';

type ParamValue = number | number[] | boolean;
type ParamMap = Record<string, ParamValue>;

interface ViewerDispatchProps {
  /** 推論に投入した 518×518 パディング済み ImageData（image テクスチャ用） */
  imageData: ImageData;
  /** 推論結果（depth テクスチャ + sourceWidth/Height） */
  depthResult: DepthResult;
  /** 視差パラメータ */
  config: ParallaxConfig;
  /** 操作モード。'orbit' のとき OrbitViewer を、それ以外で EffectViewer を出す */
  viewMode: ViewMode;
  /** 視差ビュー時に選択中のエフェクト（viewMode='parallax' のときだけ参照される） */
  currentEffect: EffectType;
  /** 視差ビュー時のエフェクトパラメータ */
  currentParams: ParamMap;
  /** 3D ビュー時のパラメータ（depthScale / autoRotate） */
  orbitParams: ParamMap;
  /** useParallax / useOrbit の hasGyro を親に伝える（コントロールバー表示判定用） */
  onGyroSupport?: (supported: boolean) => void;
  /** 親側でジャイロ許可ボタンから呼ぶための ref */
  requestGyroPermissionRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

/**
 * viewMode に応じて EffectViewer / OrbitViewer を切替える薄いディスパッチャ。
 * 各 Viewer は別の WebGL2 コンテキスト・別の hook 群を抱えるため、コンポーネントごと差し替えて
 * 「同じ canvas に異なるレンダラを new」する状態汚染を構造的に防ぐ。
 */
export function ViewerDispatch({
  imageData,
  depthResult,
  config,
  viewMode,
  currentEffect,
  currentParams,
  orbitParams,
  onGyroSupport,
  requestGyroPermissionRef,
}: ViewerDispatchProps) {
  if (viewMode === 'orbit') {
    return (
      <OrbitViewer
        imageData={imageData}
        depthResult={depthResult}
        config={config}
        currentParams={orbitParams}
        onGyroSupport={onGyroSupport}
        requestGyroPermissionRef={requestGyroPermissionRef}
      />
    );
  }
  return (
    <EffectViewer
      imageData={imageData}
      depthResult={depthResult}
      config={config}
      currentEffect={currentEffect}
      currentParams={currentParams}
      onGyroSupport={onGyroSupport}
      requestGyroPermissionRef={requestGyroPermissionRef}
    />
  );
}
