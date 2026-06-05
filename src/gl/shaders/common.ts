/** EffectRenderer 用の共通シェーダー文字列。GLSL に #include が無いため JS の文字列連結で組む。 */

/** 頂点シェーダー（全エフェクト共通のフルスクリーンクワッド）。 */
export const VERTEX_SHADER_FULLSCREEN = `#version 300 es

in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

/**
 * 共通 uniform 宣言（フラグメントシェーダーのヘッダー）。sampler は出さず、各エフェクトが
 * 使う sampler（u_image / u_depthMap / u_previousPass）だけを個別ソースで宣言する。
 */
export const COMMON_UNIFORMS_DECL = `
uniform vec2  u_offset;
uniform float u_maxDisplacement;
uniform vec2  u_resolution;
uniform float u_edgeZoom;
uniform vec2  u_sourceAspectScale;
uniform float u_time;
`;

/**
 * 視差変位を適用したサンプリング座標を計算するヘルパー。
 * - パディング/レターボックス領域なら false を返す（呼び出し側は黒で早期 return）
 * - depth は u_depthMap（0=手前, 1=奥 正規化済み前提）。extraOffset は Anaglyph の視点ずらし等（通常 vec2(0.0)）
 * - 利用側は事前に `uniform sampler2D u_depthMap;` を宣言すること
 */
export const PARALLAX_SAMPLE_HELPER = `
bool imageCoordForParallax(vec2 baseCoord, vec2 extraOffset, out vec2 sampledCoord) {
  vec2 aspectCoord = (baseCoord - 0.5) * u_sourceAspectScale + 0.5;

  if (aspectCoord.x < 0.0 || aspectCoord.x > 1.0 ||
      aspectCoord.y < 0.0 || aspectCoord.y > 1.0) {
    sampledCoord = vec2(0.0);
    return false;
  }

  vec2 zoomedCoord = (aspectCoord - 0.5) / u_edgeZoom + 0.5;

  float depth = texture(u_depthMap, zoomedCoord).r;
  vec2 displacement = (u_offset + extraOffset) * (1.0 - depth) * u_maxDisplacement / u_resolution;
  sampledCoord = clamp(zoomedCoord + displacement, 0.0, 1.0);
  return true;
}
`;

/** uniform location キャッシュ用の共通 uniform 名。sampler はパスごとに使う分だけ問い合わせる
 *  ため含めてよい（未使用なら getUniformLocation が null を返すだけ）。 */
export const COMMON_UNIFORM_NAMES: readonly string[] = [
  'u_image',
  'u_depthMap',
  'u_previousPass',
  'u_offset',
  'u_maxDisplacement',
  'u_resolution',
  'u_edgeZoom',
  'u_sourceAspectScale',
  'u_time',
];
