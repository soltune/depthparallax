/**
 * Anaglyph 3D（赤青立体視）の EffectDescriptor。左目視点=赤ch、右目視点=緑青ch を深度ベースの
 * 水平オフセットで生成し合成する。u_offset（マウス）は左右視点ベースに加算される。
 *
 * 単位整合: px 単位の u_eyeSeparation を u_offset と同じ正規化スケールへ変換するには
 * u_maxDisplacement で割る（ヘルパー内で u_maxDisplacement/u_resolution が掛かるため）。左右で ±half。
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

uniform float u_eyeSeparation;

in vec2 v_texCoord;
out vec4 outColor;

${PARALLAX_SAMPLE_HELPER}

void main() {
  // px → 正規化スケール（u_maxDisplacement で割る、上記「単位整合」参照）
  float halfSep = u_eyeSeparation * 0.5 / u_maxDisplacement;

  vec2 leftSampled, rightSampled;
  bool leftIn  = imageCoordForParallax(v_texCoord, vec2(-halfSep, 0.0), leftSampled);
  bool rightIn = imageCoordForParallax(v_texCoord, vec2(+halfSep, 0.0), rightSampled);

  if (!leftIn || !rightIn) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float red = texture(u_image, leftSampled).r;
  vec2  gb  = texture(u_image, rightSampled).gb;
  outColor = vec4(red, gb.x, gb.y, 1.0);
}
`;

export const anaglyphEffect: EffectDescriptor = {
  type: 'anaglyph',
  displayName: '赤青メガネ用 3D',
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
      name: 'eyeSeparation',
      label: '左右の視差（px）',
      type: 'float',
      min: 0.0,
      max: 60.0,
      default: 20.0,
      step: 1.0,
    },
  ],
  group: 'filter',
  primaryParam: 'eyeSeparation',
};
