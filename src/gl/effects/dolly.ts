/**
 * Dolly Zoom エフェクト（A: 自動ヴェルティゴ演出）の EffectDescriptor。
 *
 * 視差変位後の座標で depth を引き、焦点深度との差分で放射状ズームをかける。
 * `u_dollyAmount` が 0 のとき視差のみと同じ出力になる（被写体保持の保証）。
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

uniform float u_dollyAmount;
uniform float u_dollyFocalDepth;

in vec2 v_texCoord;
out vec4 outColor;

${PARALLAX_SAMPLE_HELPER}

void main() {
  vec2 sampledCoord;
  if (!imageCoordForParallax(v_texCoord, vec2(0.0), sampledCoord)) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // 視差後座標で depth を引いて、焦点深度との差分で放射状スケールを作る
  float depth = texture(u_depthMap, sampledCoord).r;
  float relative = depth - u_dollyFocalDepth;
  float scale = 1.0 + u_dollyAmount * relative;
  scale = max(scale, 0.01);

  vec2 toCenter = sampledCoord - 0.5;
  vec2 zoomed = toCenter / scale + 0.5;

  outColor = texture(u_image, clamp(zoomed, 0.0, 1.0));
}
`;

export const dollyEffect: EffectDescriptor = {
  type: 'dolly',
  displayName: 'ドリーズーム',
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
      name: 'dollyAmount',
      label: '効果の強さ',
      type: 'float',
      min: -1.0,
      max: 1.0,
      default: 0.0,
      step: 0.05,
      bipolar: true,
      bipolarLabels: { negative: '広角', positive: '望遠' },
    },
    {
      name: 'dollyFocalDepth',
      label: '焦点深度',
      type: 'float',
      min: 0.0,
      max: 1.0,
      default: 0.5,
      step: 0.05,
    },
    {
      name: 'dollyFocalAuto',
      label: '焦点を自動で合わせる',
      type: 'bool',
      default: true,
    },
    {
      // 自動再生 1 サイクルの長さに掛かる時間スケール。
      // App.tsx 側で DOLLY_DURATION_MS / dollySpeed として cycle 長を算出する。
      name: 'dollySpeed',
      label: '再生速度',
      type: 'float',
      min: 0.3,
      max: 2.0,
      default: 1.0,
      step: 0.1,
    },
  ],
  group: 'motion',
  primaryParam: 'dollyAmount',
};
