import type { DepthResult } from '../types';

/** Matplotlib viridis 風カラーマップ（11 ストップを線形補間、t∈[0,1]、0=紺→1=黄）。 */
const VIRIDIS_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [68, 1, 84],
  [72, 35, 116],
  [64, 67, 135],
  [52, 94, 141],
  [41, 120, 142],
  [32, 144, 140],
  [34, 167, 132],
  [68, 190, 112],
  [121, 209, 81],
  [189, 222, 38],
  [253, 231, 36],
];

function viridis(t: number): [number, number, number] {
  if (!Number.isFinite(t)) return [0, 0, 0];
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const last = VIRIDIS_STOPS.length - 1;
  const idx = clamped * last;
  const i0 = Math.floor(idx);
  const i1 = Math.min(last, i0 + 1);
  const f = idx - i0;
  const [r0, g0, b0] = VIRIDIS_STOPS[i0];
  const [r1, g1, b1] = VIRIDIS_STOPS[i1];
  return [
    Math.round(r0 + (r1 - r0) * f),
    Math.round(g0 + (g1 - g0) * f),
    Math.round(b0 + (b1 - b0) * f),
  ];
}

/** 有効領域（パディング除く中央矩形）を算出。imageUtils.prepareImageForInference と同じスケール計算。 */
function computeEffectiveRect(
  depthWidth: number,
  depthHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number; w: number; h: number } {
  const longest = Math.max(sourceWidth, sourceHeight);
  const scale = depthWidth / longest;
  const scaledW = Math.round(sourceWidth * scale);
  const scaledH = Math.round(sourceHeight * scale);
  const x = Math.floor((depthWidth - scaledW) / 2);
  const y = Math.floor((depthHeight - scaledH) / 2);
  return { x, y, w: scaledW, h: scaledH };
}

/**
 * depthResult の有効領域を viridis で塗って canvas に描画する。
 * canvas の内部サイズは有効領域（≒元画像アスペクト）になる（表示サイズは呼び出し側 CSS）。
 */
export function renderDepthToCanvas(
  canvas: HTMLCanvasElement,
  depthResult: DepthResult,
): void {
  const { depthMap, width, height, sourceWidth, sourceHeight } = depthResult;
  const rect = computeEffectiveRect(width, height, sourceWidth, sourceHeight);
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const imageData = ctx.createImageData(rect.w, rect.h);
  const data = imageData.data;
  for (let py = 0; py < rect.h; py++) {
    const srcY = rect.y + py;
    for (let px = 0; px < rect.w; px++) {
      const srcX = rect.x + px;
      const depth = depthMap[srcY * width + srcX];
      const [r, g, b] = viridis(depth);
      const dst = (py * rect.w + px) * 4;
      data[dst] = r;
      data[dst + 1] = g;
      data[dst + 2] = b;
      data[dst + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}
