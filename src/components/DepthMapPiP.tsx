import { useEffect, useRef } from 'react';
import { renderDepthToCanvas } from '../utils/depthMapRender';
import { useI18n } from '../i18n/LanguageProvider';
import type { DepthResult } from '../types';

/**
 * canvas 右下に常駐する小サイズ depth サムネ。タップで onOpen → 親が DepthMapModal を open。
 * pointer-events: auto で canvas pointermove に届かない。画像差替中は古い depth を表示し完了で置換。
 */
interface DepthMapPiPProps {
  depthResult: DepthResult;
  onOpen: () => void;
}

export function DepthMapPiP({ depthResult, onOpen }: DepthMapPiPProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderDepthToCanvas(canvas, depthResult);
  }, [depthResult]);

  return (
    <button
      type="button"
      className="dp-depth-pip"
      onClick={onOpen}
      aria-label={t.depthMap.pipAria}
    >
      <canvas ref={canvasRef} className="dp-depth-pip__canvas" aria-hidden />
    </button>
  );
}
