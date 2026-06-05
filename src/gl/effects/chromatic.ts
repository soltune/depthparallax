/**
 * Chromatic Aberration エフェクト（色収差）の EffectDescriptor。
 *
 * RGB チャンネルを深度に応じて微妙にずらす。手前と奥でずれ方向が反転する
 * （焦点深度 u_focalDepth からの符号付き距離に比例）。
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

uniform float u_aberration;
uniform float u_focalDepth;

in vec2 v_texCoord;
out vec4 outColor;

${PARALLAX_SAMPLE_HELPER}

void main() {
  vec2 sampledCoord;
  if (!imageCoordForParallax(v_texCoord, vec2(0.0), sampledCoord)) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float depth = texture(u_depthMap, sampledCoord).r;

  // 焦点位置からの符号付き距離に比例（手前と奥でずれ方向が逆）
  float defocus = depth - u_focalDepth;
  vec2 shift = vec2(u_aberration * defocus / u_resolution.x, 0.0);

  float r = texture(u_image, clamp(sampledCoord + shift, 0.0, 1.0)).r;
  float g = texture(u_image, sampledCoord).g;
  float b = texture(u_image, clamp(sampledCoord - shift, 0.0, 1.0)).b;
  outColor = vec4(r, g, b, 1.0);
}
`;

export const chromaticEffect: EffectDescriptor = {
  type: 'chromatic',
  displayName: '色ずれ（色収差）',
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
      name: 'aberration',
      label: 'ずれの強さ',
      type: 'float',
      min: 0.0,
      max: 30.0,
      default: 8.0,
      step: 0.5,
    },
    {
      name: 'focalDepth',
      label: '焦点深度',
      type: 'float',
      min: 0.0,
      max: 1.0,
      default: 0.5,
      step: 0.05,
    },
  ],
  group: 'filter',
  primaryParam: 'aberration',
};
