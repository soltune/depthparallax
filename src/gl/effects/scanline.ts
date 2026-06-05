/**
 * Scanline エフェクト（走査線）の EffectDescriptor。
 *
 * CRT 風の水平走査線。depth に応じて位相をずらし、手前の走査線が流れて奥は静止して見える。
 * u_time でアニメーション（mountTime からの相対秒なので long-session でも精度を保つ）。
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

uniform float u_lineCount;
uniform float u_lineIntensity;
uniform float u_scanSpeed;

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

  // 手前ほど位相がずれる（depth=0 で最大、depth=1 で 0）
  float phase = (1.0 - depth) * u_scanSpeed * u_time;
  // 走査線は画像領域内の画像 UV で計算（パディング領域には走査線が乗らない）
  float line = fract(sampledCoord.y * u_lineCount + phase);
  float mask = smoothstep(0.0, 0.5, line) * smoothstep(1.0, 0.5, line);

  vec3 colored = baseColor * (1.0 - u_lineIntensity * (1.0 - mask));
  outColor = vec4(colored, 1.0);
}
`;

export const scanlineEffect: EffectDescriptor = {
  type: 'scanline',
  displayName: 'CRT風',
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
      name: 'lineCount',
      label: 'ライン数',
      type: 'float',
      min: 50,
      max: 500,
      default: 200,
      step: 10,
    },
    {
      name: 'lineIntensity',
      label: '濃さ',
      type: 'float',
      min: 0.0,
      max: 1.0,
      default: 0.4,
      step: 0.05,
    },
    {
      name: 'scanSpeed',
      label: '流れる速さ',
      type: 'float',
      min: 0.0,
      max: 5.0,
      default: 1.5,
      step: 0.1,
    },
  ],
  group: 'filter',
  primaryParam: 'lineIntensity',
};
