import { useEffect, useMemo, useRef, useState } from 'react';
import { EffectRenderer } from '../gl/EffectRenderer';
import { computeAspectScale } from '../gl/aspect';
import { ParticleLayer, indexToParticleType } from '../gl/ParticleLayer';
import { useParallax } from '../hooks/useParallax';
import { clampedDpr, detectMobile } from '../utils/platform';
import { useI18n } from '../i18n/LanguageProvider';
import type { DepthResult, EffectType, ParallaxConfig } from '../types';

type ParamValue = number | number[] | boolean;
type ParamMap = Record<string, ParamValue>;

interface EffectViewerProps {
  imageData: ImageData;
  depthResult: DepthResult;
  config: ParallaxConfig;
  currentEffect: EffectType;
  currentParams: ParamMap;
  onGyroSupport?: (supported: boolean) => void;
  requestGyroPermissionRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

/**
 * EffectRenderer 系（parallax / fog / scanline / chromatic / neon / anaglyph / dof /
 * tiltshift / dolly / particles）を描画するビューア。orbit の SceneRenderer 系とは分離
 * （useParallax と useOrbit の二重発火回避）。
 */
export function EffectViewer({
  imageData,
  depthResult,
  config,
  currentEffect,
  currentParams,
  onGyroSupport,
  requestGyroPermissionRef,
}: EffectViewerProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<EffectRenderer | null>(null);
  const particleLayerRef = useRef<ParticleLayer | null>(null);
  const mountTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  // 最新の imageData / depthResult を保持し、context restored で再アップロードする
  const latestTexturesRef = useRef<{ imageData: ImageData; depthResult: DepthResult } | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const currentEffectRef = useRef<EffectType>(currentEffect);
  currentEffectRef.current = currentEffect;

  const isMobile = useMemo(() => detectMobile(), []);

  const { getOffset, hasGyro, requestGyroPermission } = useParallax(containerRef, config);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: EffectRenderer;
    try {
      renderer = new EffectRenderer(canvas);
    } catch (e) {
      console.error('[EffectViewer] init failed', e);
      setInitError(e instanceof Error ? e.message : String(e));
      return;
    }
    rendererRef.current = renderer;
    mountTimeRef.current = performance.now();
    lastFrameTimeRef.current = 0;

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
        console.error('[EffectViewer] re-upload after context restored failed', e);
      }
    });

    if (import.meta.env.DEV) {
      (window as unknown as { __effectRenderer?: EffectRenderer }).__effectRenderer = renderer;
    }

    try {
      const w0 = canvas.clientWidth || 1;
      const h0 = canvas.clientHeight || 1;
      renderer.resize(w0, h0, clampedDpr(isMobile));
    } catch (e) {
      console.error('[EffectViewer] initial resize failed', e);
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
            console.error('[EffectViewer] resize failed', e);
            setInitError(e instanceof Error ? e.message : String(e));
          }
        }
      }
    });
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      if (particleLayerRef.current) {
        particleLayerRef.current.dispose();
        particleLayerRef.current = null;
      }
      renderer.dispose();
      rendererRef.current = null;
      if (import.meta.env.DEV) {
        const w = window as unknown as { __effectRenderer?: EffectRenderer };
        if (w.__effectRenderer === renderer) delete w.__effectRenderer;
      }
    };
  }, []);

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
    if (particleLayerRef.current) {
      particleLayerRef.current.setDepthTexture(renderer.getDepthTexture());
    }
  }, [imageData, depthResult]);

  // エフェクト切替時とパラメータ変更時の useEffect は **必ず分離**する。
  const currentParamsRef = useRef<ParamMap>(currentParams);
  useEffect(() => {
    currentParamsRef.current = currentParams;
  }, [currentParams]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setEffect(currentEffect);
    renderer.setEffectParams(currentParamsRef.current);

    const wantsParticles = currentEffect === 'particles';

    if (wantsParticles) {
      if (!particleLayerRef.current) {
        try {
          const layer = new ParticleLayer(renderer.getGL());
          layer.setDepthTexture(renderer.getDepthTexture());
          const params = currentParamsRef.current;
          const type = indexToParticleType(
            typeof params.particleType === 'number' ? params.particleType : 0,
          );
          const count =
            typeof params.particleCount === 'number' ? params.particleCount : 300;
          layer.setParticleType(type, count);
          particleLayerRef.current = layer;
        } catch (e) {
          console.error('[EffectViewer] ParticleLayer init failed', e);
        }
      }
    } else if (particleLayerRef.current) {
      particleLayerRef.current.dispose();
      particleLayerRef.current = null;
    }
  }, [currentEffect]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setEffectParams(currentParams);

    if (currentEffect === 'particles' && particleLayerRef.current) {
      const type = indexToParticleType(
        typeof currentParams.particleType === 'number' ? currentParams.particleType : 0,
      );
      const count =
        typeof currentParams.particleCount === 'number' ? currentParams.particleCount : 300;
      particleLayerRef.current.setParticleType(type, count);
    }
  }, [currentParams, currentEffect]);

  useEffect(() => {
    let rafId = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const renderer = rendererRef.current;
      if (renderer) {
        const [ox, oy] = getOffset();
        const now = performance.now();
        const timeSeconds = (now - mountTimeRef.current) / 1000;

        const prev = lastFrameTimeRef.current;
        const dt = prev === 0 ? 1 / 60 : Math.min(0.1, (now - prev) / 1000);
        lastFrameTimeRef.current = now;

        renderer.setCompositeMode(currentEffectRef.current === 'particles');

        renderer.render(ox, oy, config.maxDisplacement, config.edgeZoom, timeSeconds);

        const particleLayer = particleLayerRef.current;
        if (
          currentEffectRef.current === 'particles' &&
          particleLayer &&
          latestTexturesRef.current
        ) {
          const composite = renderer.getCompositeTexture();
          if (composite) {
            const params = currentParamsRef.current;
            const fallSpeed =
              typeof params.fallSpeed === 'number' ? params.fallSpeed : 0.3;
            const windSway =
              typeof params.windSway === 'number' ? params.windSway : 0.2;
            particleLayer.update(dt, { fallSpeed, windSway });

            const gl = renderer.getGL();
            const w = gl.drawingBufferWidth;
            const h = gl.drawingBufferHeight;
            const { sourceWidth, sourceHeight } = latestTexturesRef.current.depthResult;
            const aspect = computeAspectScale(sourceWidth, sourceHeight, w, h);
            particleLayer.render(composite, [w, h], {
              sourceAspectScale: aspect,
              edgeZoom: config.edgeZoom,
              offset: [ox, oy],
              maxDisplacement: config.maxDisplacement,
            });
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [getOffset, config.maxDisplacement, config.edgeZoom]);

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
          <strong style={{ color: '#ffb0b0' }}>{t.webglError.title}</strong>
          <span style={{ opacity: 0.85, maxWidth: '32rem' }}>{t.webglError.body}</span>
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
