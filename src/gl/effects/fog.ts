/**
 * Fog エフェクト（霧）の EffectDescriptor。
 *
 * 奥行きに比例して fog 色とブレンド。u_fogCurve で「奥だけ霧」と「全体的に白っぽい」を切替可能。
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

uniform vec3  u_fogColor;
uniform float u_fogDensity;
uniform float u_fogCurve;

in vec2 v_texCoord;
out vec4 outColor;

${PARALLAX_SAMPLE_HELPER}

void main() {
  vec2 sampledCoord;
  if (!imageCoordForParallax(v_texCoord, vec2(0.0), sampledCoord)) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 baseColor = texture(u_image, sampledCoord).rgb;
  float depth = texture(u_depthMap, sampledCoord).r;

  float fogAmount = pow(depth, u_fogCurve) * u_fogDensity;
  vec3 fogged = mix(baseColor, u_fogColor, clamp(fogAmount, 0.0, 1.0));
  outColor = vec4(fogged, 1.0);
}
`;

export const fogEffect: EffectDescriptor = {
  type: 'fog',
  displayName: '霧',
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
      name: 'fogColor',
      label: '霧の色',
      type: 'vec3',
      default: [0.85, 0.88, 0.95],
    },
    {
      name: 'fogDensity',
      label: '濃さ',
      type: 'float',
      min: 0.0,
      max: 1.0,
      default: 0.7,
      step: 0.05,
    },
    {
      name: 'fogCurve',
      label: '奥行きへの集中',
      type: 'float',
      min: 0.5,
      max: 4.0,
      default: 2.0,
      step: 0.1,
    },
  ],
  group: 'filter',
  primaryParam: 'fogDensity',
};
