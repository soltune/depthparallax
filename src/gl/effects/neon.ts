/**
 * Neon エフェクト（エッジグロー）の EffectDescriptor。
 *
 * 深度マップに 3x3 Sobel フィルタ（8 タップ）を適用し、エッジ部分に glow 色を加算する。
 *
 * 補足: Sobel タップは出力 FBO 座標系の `u_resolution` を使っており、深度マップ
 * (518x518) を画面解像度でサンプリングするため bilinear interpolation に依存する。
 */
import type { EffectDescriptor } from '../../types';
import {
  COMMON_UNIFORMS_DECL,
  PARALLAX_SAMPLE_HELPER,
} from '../shaders/common.ts';

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform sampler2D u_depthMap;
${COMMON_UNIFORMS_DECL}

uniform vec3  u_glowColor;
uniform float u_edgeThreshold;
uniform float u_glowIntensity;

in vec2 v_texCoord;
out vec4 outColor;

${PARALLAX_SAMPLE_HELPER}

float depthEdge(vec2 uv) {
  vec2 px = 1.0 / u_resolution;
  float d00 = texture(u_depthMap, uv + vec2(-px.x, -px.y)).r;
  float d10 = texture(u_depthMap, uv + vec2( 0.0,  -px.y)).r;
  float d20 = texture(u_depthMap, uv + vec2( px.x, -px.y)).r;
  float d01 = texture(u_depthMap, uv + vec2(-px.x,  0.0 )).r;
  float d21 = texture(u_depthMap, uv + vec2( px.x,  0.0 )).r;
  float d02 = texture(u_depthMap, uv + vec2(-px.x,  px.y)).r;
  float d12 = texture(u_depthMap, uv + vec2( 0.0,   px.y)).r;
  float d22 = texture(u_depthMap, uv + vec2( px.x,  px.y)).r;
  float gx = (d20 + 2.0 * d21 + d22) - (d00 + 2.0 * d01 + d02);
  float gy = (d02 + 2.0 * d12 + d22) - (d00 + 2.0 * d10 + d20);
  return length(vec2(gx, gy));
}

void main() {
  vec2 sampledCoord;
  if (!imageCoordForParallax(v_texCoord, vec2(0.0), sampledCoord)) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 baseColor = texture(u_image, sampledCoord).rgb;

  float edge = depthEdge(sampledCoord);
  float glow = smoothstep(u_edgeThreshold, u_edgeThreshold * 2.0, edge);
  vec3 result = baseColor + u_glowColor * glow * u_glowIntensity;
  outColor = vec4(result, 1.0);
}
`;

export const neonEffect: EffectDescriptor = {
  type: 'neon',
  displayName: 'ネオングロー',
  passes: [
    {
      vertexShader: 'fullscreen',
      fragmentShader: FRAGMENT_SHADER,
      output: 'screen',
      inputs: ['image', 'depth'],
    },
  ],
  params: [
    {
      name: 'glowColor',
      label: 'グロー色',
      type: 'vec3',
      default: [0.2, 0.9, 1.0],
    },
    {
      name: 'edgeThreshold',
      label: 'エッジ閾値',
      type: 'float',
      min: 0.005,
      max: 0.1,
      default: 0.02,
      step: 0.005,
    },
    {
      name: 'glowIntensity',
      label: '強さ',
      type: 'float',
      min: 0.0,
      max: 3.0,
      default: 1.5,
      step: 0.1,
    },
  ],
  group: 'filter',
  primaryParam: 'glowIntensity',
};
