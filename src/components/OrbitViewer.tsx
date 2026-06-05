import { useEffect, useMemo, useRef, useState } from 'react';
import { SceneRenderer } from '../gl/SceneRenderer';
import { useOrbit } from '../hooks/useOrbit';
import { clampedDpr, detectMobile } from '../utils/platform';
import type { DepthResult, ParallaxConfig } from '../types';

type ParamValue = number | number[] | boolean;
type ParamMap = Record<string, ParamValue>;

/**
 * 画像が perspective camera (FOV_Y π/4, canvas aspect = srcAspect) に収まる初期 distance。
 * メッシュは (sx,sy)=(sourceW,sourceH)/maxSide の長方形（max=1）。縦長ほど大きい distance が要る。余裕 1.15 倍。
 */
function fitDistanceForImage(sourceWidth: number, sourceHeight: number): number {
  if (sourceWidth <= 0 || sourceHeight <= 0) return 2.5;
  const FOV_Y = Math.PI / 4;
  const tanHalf = Math.tan(FOV_Y / 2);
  const aspect = sourceWidth / sourceHeight;
  const maxSide = Math.max(sourceWidth, sourceHeight);
  const sx = sourceWidth / maxSide;
  const sy = sourceHeight / maxSide;
  // 垂直方向: distance ≥ sy / tan(fov/2)
  // 水平方向: distance ≥ sx / (tan(fov/2) * aspect)
  const dVert = sy / tanHalf;
  const dHorz = sx / (tanHalf * Math.max(aspect, 1e-3));
  return Math.max(dVert, dHorz) * 1.15;
}

interface OrbitViewerProps {
  imageData: ImageData;
  depthResult: DepthResult;
  config: ParallaxConfig;
  currentParams: ParamMap;
  onGyroSupport?: (supported: boolean) => void;
  requestGyroPermissionRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

/**
 * Orbit エフェクト専用ビューア。SceneRenderer + useOrbit でメッシュをドラッグ / ピンチ / ジャイロ操作する。
 * EffectViewer とは独立した WebGL2 コンテキストを持ち、切替時は unmount/remount で作り直す（状態汚染対策）。
 */
export function OrbitViewer({
  imageData,
  depthResult,
  config,
  currentParams,
  onGyroSupport,
  requestGyroPermissionRef,
}: OrbitViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const latestTexturesRef = useRef<{ imageData: ImageData; depthResult: DepthResult } | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const isMobile = useMemo(() => detectMobile(), []);

  // useOrbit の config を param から組み立てる。sensitivity は schema に無いため常に 1.0 fallback。
  const orbitConfig = useMemo(
    () => ({
      sensitivity:
        typeof currentParams.orbitSensitivity === 'number'
          ? currentParams.orbitSensitivity
          : 1.0,
      autoRotate:
        typeof currentParams.autoRotate === 'boolean'
          ? currentParams.autoRotate
          : false,
      useGyro: config.useGyro,
    }),
    [currentParams.orbitSensitivity, currentParams.autoRotate, config.useGyro],
  );

  const { getOrbit, resetOrbit, hasGyro, requestGyroPermission } = useOrbit(
    containerRef,
    orbitConfig,
  );

  useEffect(() => {
    onGyroSupport?.(hasGyro);
  }, [hasGyro, onGyroSupport]);

  useEffect(() => {
    if (requestGyroPermissionRef) {
      requestGyroPermissionRef.current = requestGyroPermission;
    }
    return () => {
      if (requestGyroPermissionRef) {
        requestGyroPermissionRef.current = null;
      }
    };
  }, [requestGyroPermission, requestGyroPermissionRef]);

  // SceneRenderer 初期化 + ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: SceneRenderer;
    try {
      renderer = new SceneRenderer(canvas);
    } catch (e) {
      console.error('[OrbitViewer] init failed', e);
      setInitError(e instanceof Error ? e.message : String(e));
      return;
    }
    rendererRef.current = renderer;

    renderer.setOnContextRestored(() => {
      const latest = latestTexturesRef.current;
      if (!latest) return;
      try {
        renderer.setTextures(
          latest.imageData,
          latest.depthResult.depthMap,
          latest.depthResult.width,
          latest.depthResult.height,
          latest.depthResult.sourceWidth,
          latest.depthResult.sourceHeight,
        );
      } catch (e) {
        console.error('[OrbitViewer] re-upload after context restored failed', e);
      }
    });

    if (import.meta.env.DEV) {
      (window as unknown as { __sceneRenderer?: SceneRenderer }).__sceneRenderer = renderer;
    }

    try {
      const w0 = canvas.clientWidth || 1;
      const h0 = canvas.clientHeight || 1;
      renderer.resize(w0, h0, clampedDpr(isMobile));
    } catch (e) {
      console.error('[OrbitViewer] initial resize failed', e);
      setInitError(e instanceof Error ? e.message : String(e));
      renderer.dispose();
      rendererRef.current = null;
      return;
    }

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          try {
            renderer.resize(width, height, clampedDpr(isMobile));
          } catch (e) {
            console.error('[OrbitViewer] resize failed', e);
            setInitError(e instanceof Error ? e.message : String(e));
          }
        }
      }
    });
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
      if (import.meta.env.DEV) {
        const w = window as unknown as { __sceneRenderer?: SceneRenderer };
        if (w.__sceneRenderer === renderer) delete w.__sceneRenderer;
      }
    };
  }, []);

  // テクスチャ更新（画像差し替え時は姿勢もリセット）
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    latestTexturesRef.current = { imageData, depthResult };
    renderer.setTextures(
      imageData,
      depthResult.depthMap,
      depthResult.width,
      depthResult.height,
      depthResult.sourceWidth,
      depthResult.sourceHeight,
    );
    // 画像アスペクト比に応じて初期 distance を最適化（縦長画像でも全体が見える）
    resetOrbit(fitDistanceForImage(depthResult.sourceWidth, depthResult.sourceHeight));
  }, [imageData, depthResult, resetOrbit]);

  // 最新 params を rAF クロージャから参照するための ref
  const currentParamsRef = useRef<ParamMap>(currentParams);
  useEffect(() => {
    currentParamsRef.current = currentParams;
  }, [currentParams]);

  // rAF ループ
  useEffect(() => {
    let rafId = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const renderer = rendererRef.current;
      if (renderer) {
        const orbit = getOrbit();
        const depthScale =
          typeof currentParamsRef.current.depthScale === 'number'
            ? currentParamsRef.current.depthScale
            : 0.5;
        // 画像端 5% の Z 変位を smoothstep で 0 に倒す（depth が最外周で暴れ「家の庇」状の出っ張りが出るのを抑える）。
        renderer.render(orbit, { depthScale, edgeFadeWidth: 0.05 });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [getOrbit]);

  const srcAspect =
    depthResult.sourceWidth > 0 && depthResult.sourceHeight > 0
      ? depthResult.sourceWidth / depthResult.sourceHeight
      : 16 / 9;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: `calc(70vh * ${srcAspect})`,
        aspectRatio: `${srcAspect}`,
        margin: '0 auto',
        touchAction: 'none',
        lineHeight: 0,
        background: '#000',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
        }}
      />
      {initError && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '1rem',
            background: 'rgba(20, 10, 10, 0.85)',
            color: '#ffd0d0',
            fontSize: '0.85rem',
            lineHeight: 1.5,
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <strong style={{ color: '#ffb0b0' }}>
            3D ビューを初期化できませんでした
          </strong>
          <span style={{ opacity: 0.85, maxWidth: '32rem' }}>
            お使いのブラウザ / GPU 環境では頂点シェーダーからの深度サンプリング（VTF）
            が利用できない可能性があります。 別のエフェクトをお試しください。
          </span>
          <code
            style={{
              fontSize: '0.75rem',
              opacity: 0.7,
              maxWidth: '90%',
              wordBreak: 'break-word',
            }}
          >
            {initError}
          </code>
        </div>
      )}
    </div>
  );
}
