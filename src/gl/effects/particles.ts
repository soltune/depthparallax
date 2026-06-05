/**
 * Particles エフェクト（C: 深度連動パーティクル）の EffectDescriptor。
 *
 * フラグメントは parallax と同じ「視差変位後の画像を出力するだけ」。
 * 粒子描画は ParticleLayer 側で実施し、本 Descriptor は背景レンダリングと
 * UI（パラメータスキーマ）の入口を提供する役割。
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

in vec2 v_texCoord;
out vec4 outColor;

${PARALLAX_SAMPLE_HELPER}

void main() {
  vec2 sampledCoord;
  if (!imageCoordForParallax(v_texCoord, vec2(0.0), sampledCoord)) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  outColor = texture(u_image, sampledCoord);
}
`;

export const particlesEffect: EffectDescriptor = {
  type: 'particles',
  displayName: 'パーティクル',
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
      name: 'particleType',
      label: '種類',
      type: 'enum',
      default: 0,
      options: [
        { value: 0, label: '❄ 雪' },
        { value: 1, label: '☂ 雨' },
        { value: 2, label: '🌸 花びら' },
        { value: 3, label: '✨ 蛍' },
      ],
    },
    {
      name: 'particleCount',
      label: '個数',
      type: 'float',
      min: 50,
      max: 600,
      default: 300,
      step: 50,
    },
    {
      name: 'fallSpeed',
      label: '落下速度',
      type: 'float',
      min: 0.0,
      max: 1.5,
      default: 0.3,
      step: 0.05,
    },
    {
      name: 'windSway',
      label: '横揺れ',
      type: 'float',
      min: 0.0,
      max: 1.0,
      default: 0.2,
      step: 0.05,
    },
  ],
  group: 'motion',
  primaryParam: 'particleCount',
};
