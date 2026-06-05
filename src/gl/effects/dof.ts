/**
 * DoF（被写界深度）の EffectDescriptor。3 パス: (1) 視差変位後の rgb + 視差後 depth を .a に格納、
 * (2) 横 9 タップ分離ガウス、(3) 縦 9 タップ分離ガウス（最終出力）。
 *
 * .a はパディング判定を兼ねる: 画像領域は min(depth, 254/255)、パディングは 1.0 を専用センチネルに
 * 予約する（実 depth 1.0 とマーカーの衝突で空が黒抜けするのを防ぐ）。ぼかしタップは
 * .a > PADDING_THRESHOLD(254.5/255 = 量子化境界の中点) を重み 0 にして再正規化する。
 *
 * パス1 / パス2a は Tilt-shift でも再利用するため export する。
 */
import type { EffectDescriptor } from '../../types';
import {
  COMMON_UNIFORMS_DECL,
  PARALLAX_SAMPLE_HELPER,
} from '../shaders/common.ts';

/** パス1: 視差サンプリング + depth を `.a` に保存（Tilt-shift と共通） */
export const DOF_PASS1_FRAGMENT = `#version 300 es
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
  vec3 baseColor = texture(u_image, sampledCoord).rgb;
  float depth = texture(u_depthMap, sampledCoord).r;
  // 実 depth は 254/255 にクランプ（255/255 をパディング専用センチネルに予約）
  outColor = vec4(baseColor, min(depth, 254.0 / 255.0));
}
`;

/**
 * パス2a: 横方向 9 タップ分離ガウス（Tilt-shift と共通）。パディング（.a > 閾値）は中心なら
 * 早期 return、タップなら重み 0 で再正規化。出力 .a に depth を引き継ぐ。
 */
export const DOF_PASS2_HORIZONTAL_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D u_previousPass;
${COMMON_UNIFORMS_DECL}

uniform float u_focalDepth;
uniform float u_maxBlurRadius;

in vec2 v_texCoord;
out vec4 outColor;

// 254/255 (実 depth 最大) と 255/255 (パディング・マーカー) の中点。
// このしきい値を超えるのはセンチネル 1.0 のみ。
const float PADDING_THRESHOLD = 254.5 / 255.0;

void main() {
  vec4 center = texture(u_previousPass, v_texCoord);
  if (center.a > PADDING_THRESHOLD) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float depth = center.a;
  float radius = abs(depth - u_focalDepth) * u_maxBlurRadius;

  const float weights[5] = float[](0.227027, 0.194594, 0.121622, 0.054054, 0.016216);
  vec3 sum = center.rgb * weights[0];
  float weightSum = weights[0];
  for (int i = 1; i < 5; i++) {
    vec2 ofs = vec2(float(i) * radius / u_resolution.x, 0.0);
    vec4 sR = texture(u_previousPass, v_texCoord + ofs);
    vec4 sL = texture(u_previousPass, v_texCoord - ofs);
    float wR = (sR.a > PADDING_THRESHOLD) ? 0.0 : weights[i];
    float wL = (sL.a > PADDING_THRESHOLD) ? 0.0 : weights[i];
    sum += sR.rgb * wR + sL.rgb * wL;
    weightSum += wR + wL;
  }
  sum /= max(weightSum, 0.0001);
  outColor = vec4(sum, depth);
}
`;

/**
 * パス2b: 縦方向 9 タップ分離ガウス（DoF 専用・最終出力）。
 * 横パスと同じ早期 return + パディング除外を縦軸版で行い、`.a = 1.0` で出力する。
 */
const DOF_PASS2_VERTICAL_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D u_previousPass;
${COMMON_UNIFORMS_DECL}

uniform float u_focalDepth;
uniform float u_maxBlurRadius;

in vec2 v_texCoord;
out vec4 outColor;

const float PADDING_THRESHOLD = 254.5 / 255.0;

void main() {
  vec4 center = texture(u_previousPass, v_texCoord);
  if (center.a > PADDING_THRESHOLD) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float depth = center.a;
  float radius = abs(depth - u_focalDepth) * u_maxBlurRadius;

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
  outColor = vec4(sum, 1.0);
}
`;

export const dofEffect: EffectDescriptor = {
  type: 'dof',
  displayName: '背景ぼかし（被写界深度）',
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
      fragmentShader: DOF_PASS2_VERTICAL_FRAGMENT,
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
      // UI 専用フラグ（uniform には流さない）。hiddenParams で grid から外し FocalDepthControl が
      // focalDepth を駆動。ON で画像中央ブロックの平均 depth を focalDepth に自動セット。
      name: 'focalAuto',
      label: '焦点深度を自動',
      type: 'bool',
      default: true,
    },
    {
      name: 'maxBlurRadius',
      label: 'ぼかしの強さ（px）',
      type: 'float',
      min: 1.0,
      max: 20.0,
      default: 9.0,
      step: 0.5,
    },
  ],
  group: 'filter',
  primaryParam: 'focalDepth',
};
