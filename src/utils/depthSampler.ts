/**
 * focalAuto ON 時に焦点深度の代表値を採るサンプリング。入力 depthMap は正規化済み
 * （0=手前, 1=奥）前提だが、安全側で finite チェックする。
 */
import type { DepthResult } from '../types';

/** 画像中央 1px の depth（dolly 用）。finite でなければ null。 */
export function sampleCenterDepth(
  result: Pick<DepthResult, 'depthMap' | 'width' | 'height'>,
): number | null {
  const { depthMap, width, height } = result;
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const depth = depthMap[cy * width + cx];
  return Number.isFinite(depth) ? depth : null;
}

/**
 * 画像中央 NxN ブロックの平均 depth（dof / tiltshift 用）。finite な値が無ければ null。
 * ratio は短辺に対する N の比率（既定 0.05 → 短辺 518 で N=25）、N は minSize..maxSize に clamp。
 */
export function sampleCenterDepthBlock(
  result: Pick<DepthResult, 'depthMap' | 'width' | 'height'>,
  ratio = 0.05,
  minSize = 3,
  maxSize = 33,
): number | null {
  const { depthMap, width, height } = result;
  if (width <= 0 || height <= 0 || depthMap.length < width * height) return null;

  const shortSide = Math.min(width, height);
  const rawN = Math.round(shortSide * ratio);
  const n = Math.max(minSize, Math.min(maxSize, rawN | 0));
  const half = Math.floor(n / 2);

  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const x0 = Math.max(0, cx - half);
  const y0 = Math.max(0, cy - half);
  const x1 = Math.min(width, cx - half + n);
  const y1 = Math.min(height, cy - half + n);

  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      const v = depthMap[row + x];
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
  }
  return count > 0 ? sum / count : null;
}
