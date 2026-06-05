/**
 * Tilt-shift（ミニチュア風）の EffectDescriptor。DoF の 3 パスを流用し、最終パスでのみ
 * 焦点帯（u_focalBandWidth）外に defocus を限定 + 焦点域の彩度ブースト（u_saturationBoost）。
 * パス1 / パス2a は DoF のシェーダーを再利用（帯狭めは縦パスで再計算するため横は DoF 挙動でよい）。
 */
import type { EffectDescriptor } from '../../types';
import { COMMON_UNIFORMS_DECL } from '../shaders/common.ts';
import { DOF_PASS1_FRAGMENT, DOF_PASS2_HORIZONTAL_FRAGMENT } from './dof.ts';

/**
 * パス2b: 縦方向 9 タップ分離ガウス + 焦点帯狭め + 彩度ブースト（Tilt-shift 専用・最終出力）。
 * - `.a > 0.99` のサンプルはパディング扱いで重み 0 → 再正規化
 * - 焦点帯外でのみ defocus が立ち上がる（`max(0, |depth - focal| - bandWidth)`）
 * - 焦点帯内では smoothstep 由来の inFocus で彩度ブーストを混ぜる
 */
const TILTSHIFT_PASS2_VERTICAL_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D u_previousPass;
${COMMON_UNIFORMS_DECL}

uniform float u_focalDepth;
uniform float u_focalBandWidth;
uniform float u_maxBlurRadius;
uniform float u_saturationBoost;

in vec2 v_texCoord;
out vec4 outColor;

const float PADDING_THRESHOLD = 254.5 / 255.0;

vec3 boostSaturation(vec3 rgb, float amount) {
  float l = dot(rgb, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), rgb, amount);
}

void main() {
  vec4 center = texture(u_previousPass, v_texCoord);
  if (center.a > PADDING_THRESHOLD) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float depth = center.a;
  float defocus = max(0.0, abs(depth - u_focalDepth) - u_focalBandWidth);
  float radius = defocus * u_maxBlurRadius;

  const float weights[5] = float[](0.227027, 0.194594, 0.121622, 0.054054, 0.016216);
  vec3 sum = center.rgb * weights[0];
  float weightSum = weights[0];
  for (int i = 1; i < 5; i++) {
    vec2 ofs = vec2(0.0, float(i) * radius / u_resolution.y);
    vec4 sU = texture(u_previousPass, v_texCoord + ofs);
    vec4 sD = texture(u_previousPass, v_texCoord - ofs);
    float wU = (sU.a > PADDING_THRESHOLD) ? 0.0 : weights[i];
    float wD = (sD.a > PADDING_THRESHOLD) ? 0.0 : weights[i];
    sum += sU.rgb * wU + sD.rgb * wD;
    weightSum += wU + wD;
  }
  sum /= max(weightSum, 0.0001);

  float inFocus = 1.0 - smoothstep(0.0, u_focalBandWidth, abs(depth - u_focalDepth));
  vec3 result = boostSaturation(sum, mix(1.0, u_saturationBoost, inFocus));
  outColor = vec4(result, 1.0);
}
`;

export const tiltshiftEffect: EffectDescriptor = {
  type: 'tiltshift',
  displayName: 'ミニチュア風',
  passes: [
    {
      vertexShader: 'fullscreen',
      fragmentShader: DOF_PASS1_FRAGMENT,
      output: 'fbo',
      inputs: ['image', 'depth'],
    },
    {
      vertexShader: 'fullscreen',
      fragmentShader: DOF_PASS2_HORIZONTAL_FRAGMENT,
      output: 'fbo',
      inputs: ['previousPass'],
    },
    {
      vertexShader: 'fullscreen',
      fragmentShader: TILTSHIFT_PASS2_VERTICAL_FRAGMENT,
      output: 'screen',
      inputs: ['previousPass'],
    },
  ],
  params: [
    {
      name: 'focalDepth',
      label: '焦点深度',
      type: 'float',
      min: 0.0,
      max: 1.0,
      default: 0.5,
      step: 0.01,
    },
    {
      // UI 専用フラグ（dof と同様 hiddenParams で grid から外し FocalDepthControl で扱う）。
      name: 'focalAuto',
      label: '焦点深度を自動',
      type: 'bool',
      default: true,
    },
    {
      name: 'focalBandWidth',
      label: '焦点帯の幅',
      type: 'float',
      min: 0.02,
      max: 0.4,
      default: 0.1,
      step: 0.01,
    },
    {
      name: 'maxBlurRadius',
      label: 'ぼかしの強さ（px）',
      type: 'float',
      min: 1.0,
      max: 35.0,
      default: 15.0,
      step: 0.5,
    },
    {
      name: 'saturationBoost',
      label: '彩度倍率',
      type: 'float',
      min: 1.0,
      max: 2.5,
      default: 1.5,
      step: 0.05,
    },
  ],
  group: 'filter',
  primaryParam: 'focalDepth',
};
