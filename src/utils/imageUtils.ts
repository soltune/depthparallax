/** 推論前処理用の画像ユーティリティ（アスペクト比保持スケール + ゼロパディング、巨大画像の縮小）。 */

export type ImageSource =
  | HTMLImageElement
  | ImageBitmap
  | HTMLCanvasElement;

export interface PreparedImage {
  imageData: ImageData;
  /** パディング前の元画像実寸（有効領域の算出に使う） */
  sourceWidth: number;
  sourceHeight: number;
}

function getSourceSize(source: ImageSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/**
 * アスペクト比保持で長辺 targetSize にスケールし、正方キャンバスに中央配置（周囲ゼロパディング）。
 * Depth Anything V2 の制約で targetSize は 14 の倍数であること（既定 518 = 14×37）。
 */
export function prepareImageForInference(
  source: ImageSource,
  targetSize: number = 518,
): PreparedImage {
  const { width: sourceWidth, height: sourceHeight } = getSourceSize(source);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('prepareImageForInference: source has zero dimensions');
  }
  if (targetSize <= 0 || targetSize % 14 !== 0) {
    throw new Error(
      `prepareImageForInference: targetSize must be a positive multiple of 14 (got ${targetSize})`,
    );
  }

  const scale = targetSize / Math.max(sourceWidth, sourceHeight);
  const scaledWidth = Math.round(sourceWidth * scale);
  const scaledHeight = Math.round(sourceHeight * scale);
  const offsetX = Math.floor((targetSize - scaledWidth) / 2);
  const offsetY = Math.floor((targetSize - scaledHeight) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('prepareImageForInference: failed to get 2D context');
  }

  // パディング領域を黒で確定（alpha=0 残りによる後段の不定挙動を避ける）
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, targetSize, targetSize);

  ctx.drawImage(source, offsetX, offsetY, scaledWidth, scaledHeight);

  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);

  return {
    imageData,
    sourceWidth,
    sourceHeight,
  };
}

/**
 * 長辺が maxSide を超える場合のみ縮小した canvas を返す（以下なら source をそのまま返す）。
 * メモリ圧迫・canvas 上限（多くの環境で 16384px、モバイルはより小さい）への抵触防止が目的。
 */
export function shrinkIfTooLarge(
  source: ImageSource,
  maxSide: number = 4096,
): ImageSource {
  const { width, height } = getSourceSize(source);
  const longest = Math.max(width, height);
  if (longest <= maxSide) {
    return source;
  }

  const scale = maxSide / longest;
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('shrinkIfTooLarge: failed to get 2D context');
  }
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return canvas;
}
