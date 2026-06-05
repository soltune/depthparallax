import { useEffect, useState } from 'react';

/**
 * 開発モード専用 fps カウンタ（呼び出し側で import.meta.env.DEV ガード → 本番から除去）。
 * 直近 sampleSize 個の rAF 間隔の移動平均から算出。
 */
interface FpsCounterProps {
  sampleSize?: number;
  updateIntervalMs?: number;
}

export function FpsCounter({
  sampleSize = 60,
  updateIntervalMs = 250,
}: FpsCounterProps) {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let rafId = 0;
    let cancelled = false;
    let last = performance.now();
    let lastDisplay = last;
    const samples: number[] = [];

    const tick = (now: number) => {
      if (cancelled) return;
      const dt = now - last;
      last = now;
      samples.push(dt);
      if (samples.length > sampleSize) samples.shift();
      if (now - lastDisplay >= updateIntervalMs && samples.length > 0) {
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        setFps(avg > 0 ? 1000 / avg : null);
        lastDisplay = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [sampleSize, updateIntervalMs]);

  return (
    <div
      style={{
        position: 'fixed',
        top: '0.5rem',
        right: '0.5rem',
        padding: '0.2rem 0.5rem',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: '0.75rem',
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#a0ffa0',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: '4px',
        pointerEvents: 'none',
        zIndex: 9999,
        fontVariantNumeric: 'tabular-nums',
      }}
      aria-hidden="true"
    >
      {fps !== null ? `${fps.toFixed(1)} fps` : '— fps'}
    </div>
  );
}
