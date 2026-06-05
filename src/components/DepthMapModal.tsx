import { useEffect, useRef } from 'react';
import { renderDepthToCanvas } from '../utils/depthMapRender';
import { useI18n } from '../i18n/LanguageProvider';
import type { DepthResult } from '../types';

/**
 * 深度マップの拡大モーダル（position: fixed; inset: 0 で全画面）。背景クリック / × / Escape で onClose。
 * open 中は canvas の pointermove が遮断され useParallax の target 更新が止まるので視差が静止する。
 * パネル内クリックは stopPropagation して背景クリック扱いにしない。
 */
interface DepthMapModalProps {
  depthResult: DepthResult;
  onClose: () => void;
}

export function DepthMapModal({ depthResult, onClose }: DepthMapModalProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderDepthToCanvas(canvas, depthResult);
  }, [depthResult]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="dp-depth-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t.depthMap.modalAria}
      onClick={onClose}
    >
      <div
        className="dp-depth-modal__panel"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="dp-depth-modal__close"
          onClick={onClose}
          aria-label={t.depthMap.close}
        >
          ✕
        </button>
        <div className="dp-depth-modal__caption">{t.depthMap.caption}</div>
        <canvas ref={canvasRef} className="dp-depth-modal__canvas" />
        <div className="dp-depth-modal__legend" aria-hidden>
          <div className="dp-depth-modal__legend-bar" />
          <div className="dp-depth-modal__legend-labels">
            <span>{t.depthMap.near}</span>
            <span>{t.depthMap.far}</span>
          </div>
        </div>
        <div className="dp-depth-modal__meta">
          backend: {depthResult.backend} / {depthResult.inferenceTimeMs.toFixed(1)} ms
        </div>
      </div>
    </div>
  );
}
