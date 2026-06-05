/**
 * 深度推定結果（元画像 + 深度マップ）の WebGL2 テクスチャ化。各レンダラから再利用する。
 *
 * 不変条件:
 * - 画像・深度マップとも UNPACK_FLIP_Y_WEBGL=true（CLAUDE.md「Y軸反転は UNPACK_FLIP_Y_WEBGL のみ」）。呼び出し側で再設定しない
 * - 深度マップは R32F。OES_texture_float_linear 非対応環境は NEAREST フォールバック（floatLinear 引数で渡す）
 * - 深度値は depthUtils.normalize 済み（0=手前 / 1=奥）前提
 */

export interface DepthTextureSet {
  image: WebGLTexture;
  depth: WebGLTexture;
  imageWidth: number;
  imageHeight: number;
  depthWidth: number;
  depthHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export function uploadDepthTextures(
  gl: WebGL2RenderingContext,
  image: ImageData,
  depth: Float32Array,
  depthWidth: number,
  depthHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  floatLinear: boolean,
): DepthTextureSet {
  if (depth.length !== depthWidth * depthHeight) {
    throw new Error(
      `depth length mismatch: expected ${depthWidth * depthHeight}, got ${depth.length}`,
    );
  }

  const imageTex = gl.createTexture();
  const depthTex = gl.createTexture();
  if (!imageTex || !depthTex) {
    if (imageTex) gl.deleteTexture(imageTex);
    if (depthTex) gl.deleteTexture(depthTex);
    throw new Error('createTexture failed');
  }

  gl.bindTexture(gl.TEXTURE_2D, imageTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    image.width,
    image.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    image.data,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R32F,
    depthWidth,
    depthHeight,
    0,
    gl.RED,
    gl.FLOAT,
    depth,
  );
  const filter = floatLinear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindTexture(gl.TEXTURE_2D, null);

  return {
    image: imageTex,
    depth: depthTex,
    imageWidth: image.width,
    imageHeight: image.height,
    depthWidth,
    depthHeight,
    sourceWidth,
    sourceHeight,
  };
}

export function disposeDepthTextures(
  gl: WebGL2RenderingContext,
  set: DepthTextureSet,
): void {
  gl.deleteTexture(set.image);
  gl.deleteTexture(set.depth);
}
