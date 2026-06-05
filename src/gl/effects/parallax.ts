/**
 * Parallax エフェクト（視差のみ）の EffectDescriptor。
 * 視差変位のみ適用し追加の色加工はしない。フラグメントシェーダーは共通ヘルパー
 * (imageCoordForParallax) を呼ぶだけのシンプル構成。
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

export const parallaxEffect: EffectDescriptor = {
  type: 'parallax',
  displayName: '視差のみ',
  passes: [
    {
      vertexShader: 'fullscreen',
      fragmentShader: FRAGMENT_SHADER,
      output: 'screen',
      inputs: ['image', 'depth'],
    },
  ],
  params: [],
  group: 'filter',
};
