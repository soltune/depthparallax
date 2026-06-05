/**
 * アスペクト補正スケールの算出。推論入力は 518² のゼロパディング正方画像なので、表示時に
 * パディング（黒帯）を除外しつつ object-fit: contain 相当のレターボックスを (sx, sy) にまとめる。
 * EffectRenderer / EffectViewer / SceneRenderer から共有する。
 */

/**
 * canvas UV → テクスチャ UV のスケール係数 (sx, sy)（シェーダの tUV=(cUV-0.5)*scale+0.5 用）。
 * 2 つの補正を合成する: (1) canvas→画像領域の object-fit: contain、
 * (2) prepareImageForInference のゼロパディング除外。
 */
export function computeAspectScale(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): [number, number] {
  if (sourceWidth <= 0 || sourceHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return [1, 1];
  }
  const srcAspect = sourceWidth / sourceHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  const maxSide = Math.max(sourceWidth, sourceHeight);
  const texImgW = sourceWidth / maxSide;
  const texImgH = sourceHeight / maxSide;
  const dispW = srcAspect >= canvasAspect ? 1 : srcAspect / canvasAspect;
  const dispH = srcAspect >= canvasAspect ? canvasAspect / srcAspect : 1;
  return [texImgW / dispW, texImgH / dispH];
}

/**
 * canvas aspect 非依存の純粋な画像アスペクト比 (sourceW, sourceH)/maxSide（max 1.0、短辺<1）。
 * SceneRenderer 専用: canvas への適合は perspective 行列側で扱う（container が aspect-ratio を
 * 指定し canvas aspect = src aspect が前提）。
 */
export function imageAspectScale(
  sourceWidth: number,
  sourceHeight: number,
): [number, number] {
  if (sourceWidth <= 0 || sourceHeight <= 0) return [1, 1];
  const maxSide = Math.max(sourceWidth, sourceHeight);
  return [sourceWidth / maxSide, sourceHeight / maxSide];
}
