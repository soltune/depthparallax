/**
 * 深度連動パーティクルレイヤー。EffectRenderer の出力（compositeFbo）を背景に貼り、その上へ
 * CPU 駆動の粒子をインスタンス描画する。粒子は depth を持ち、フラグメントで深度マップと比較して
 * 前景被写体に隠れる（オクルージョン）。
 *
 * 不変条件:
 * - WebGL2 context は EffectRenderer から借りる（getGL()）。独自に getContext しない
 *   （2 回目の getContext('webgl2') が null を返す環境への配慮）
 * - 深度テクスチャは EffectRenderer.getDepthTexture()。FLIP_Y は TextureManager 内で吸収済み
 * - particleCount 変更時のみバッファ再 alloc（属性レイアウトは全種別共通なので種別変更では不要）
 */

import { buildProgram } from './glProgram';

export type ParticleType = 'snow' | 'rain' | 'petal' | 'firefly';

export const PARTICLE_TYPES: readonly ParticleType[] = [
  'snow',
  'rain',
  'petal',
  'firefly',
];

/** 数値（particles エフェクトの `particleType` uniform 値）→ enum 変換 */
export function indexToParticleType(idx: number): ParticleType {
  const i = Math.max(0, Math.min(PARTICLE_TYPES.length - 1, Math.round(idx)));
  return PARTICLE_TYPES[i];
}

type DepthBias = 'front' | 'back' | 'mid' | 'uniform';

interface ParticleProfile {
  /** 種別ごとの基準サイズ（CSS px） */
  size: number;
  /** 種別ごとの落下速度倍率（UI の fallSpeed に乗じる） */
  speedFactor: number;
  /** 寿命（秒） */
  lifetime: number;
  /** RGB（0..1） */
  color: [number, number, number];
  blend: 'alpha' | 'additive';
  /** 円形を縦長にする倍率 */
  yStretch: number;
  /** ソフトエッジ（1=ソフト円形, 0=ハード） */
  softEdge: 0 | 1;
  /** 横揺れに用いる時間係数（蛍は上下にゆらぐので独自に大きめ） */
  swayFactor: number;
  /** 再生成時の depth 分布。front=手前(E≈0.33) / back=奥(E≈0.66) / mid=中域(0.3..0.7) / uniform=一様 */
  depthBias: DepthBias;
  /** 奥ほど寄せる大気遠近色 */
  fogColor: [number, number, number];
  /** depth=1 での alpha 乗数（既定 0.4、petal は物理オブジェクト扱いで 1.0） */
  fogAlphaMin: number;
  /** Z ドリフト振幅（depth 単位）。currentDepth = baseDepth + sin(phase + t·driftFreq)·driftAmp で 3D 漂遊感 */
  driftAmp: number;
  /** Z ドリフトの角周波数（rad/s） */
  driftFreq: number;
}

/** depth (0=手前, 1=奥) を種別ごとの分布から 1 値サンプリングする。 */
function sampleDepth(bias: DepthBias): number {
  switch (bias) {
    case 'front':
      return Math.random() * Math.random();        // E ≈ 0.33（手前寄り）
    case 'back':
      return 1.0 - Math.random() * Math.random();  // E ≈ 0.66（奥寄り）
    case 'mid':
      return 0.3 + Math.random() * 0.4;            // 0.3..0.7 一様（中域）
    case 'uniform':
    default:
      return Math.random();
  }
}

// lifetime × speedFactor が概ね 1.2 以上になるよう設定（下回ると画面下部に粒子が届かず空白帯）。
// firefly のみ別戦略: 落下が主目的でないため lifetime は短く、再生成時 y を画面中ランダム配置。
const PROFILES: Record<ParticleType, ParticleProfile> = {
  snow: {
    size: 6,
    speedFactor: 0.3,
    lifetime: 14,
    color: [1.0, 1.0, 1.0],
    // 奥粒(α→0.4)が暗背景で沈むのを避け additive（小粒なので「光る雪」の違和感は出ない）
    blend: 'additive',
    yStretch: 1.0,
    softEdge: 1,
    swayFactor: 1.0,
    depthBias: 'back',   // 雪原の遠景に溶ける、奥に多く
    fogColor: [1.0, 1.0, 1.0],     // 白霞、雪原の遠景に溶ける
    fogAlphaMin: 0.4,
    driftAmp: 0.05,
    driftFreq: 0.3,
  },
  rain: {
    // 実写の雨は細い縦 streak なので size=1.3 / yStretch=5.0 で細長く、speedFactor=3.0 で速く。
    // 奥粒が暗く沈むのは additive で改善（streak が細く「光る雨」感は出にくい）。
    size: 1.3,
    speedFactor: 3.0,
    lifetime: 3,
    color: [0.9, 0.95, 0.92],
    blend: 'additive',
    yStretch: 5.0,
    softEdge: 1,
    swayFactor: 0.1,
    depthBias: 'back',
    fogColor: [0.5, 0.6, 0.75],    // 雨煙の青みがかった霞
    fogAlphaMin: 0.4,
    // 早く消えるので drift 不要
    driftAmp: 0.0,
    driftFreq: 0.0,
  },
  petal: {
    // 花弁は物理オブジェクト扱い: alpha blend 維持 + fogAlphaMin=1.0 で完全不透明にし背景輝度の
    // 影響を受けない。深度感は alpha でなく color→fogColor の色シフトで表現。
    size: 7,
    speedFactor: 0.2,
    lifetime: 20,
    color: [1.0, 0.7, 0.85],       // 鮮やかピンク（不透明なので背景に左右されない）
    blend: 'alpha',
    yStretch: 1.0,
    softEdge: 1,
    swayFactor: 1.5,
    depthBias: 'back',   // 空一面を奥寄りで覆う風情
    fogColor: [0.95, 0.85, 0.85],  // 薄ピンクのもや
    fogAlphaMin: 1.0,
    driftAmp: 0.08,
    driftFreq: 0.4,
  },
  firefly: {
    size: 4,
    speedFactor: 0.1,
    lifetime: 5,
    color: [0.85, 1.0, 0.4],
    blend: 'additive',
    yStretch: 1.0,
    softEdge: 1,
    swayFactor: 2.0,
    depthBias: 'mid',    // 近〜中距離で漂う
    fogColor: [0.0, 0.0, 0.0],     // 暗闇に沈む、点滅感が「近強・遠弱」に強調される
    fogAlphaMin: 0.4,
    // 最も強い 3D 漂遊感（mid 分布なので前後に振っても discard 急変が出にくい）
    driftAmp: 0.15,
    driftFreq: 0.6,
  },
};

/** 1 粒子分の float 数（pos.xy / currentDepth / lifetime / phase / baseDepth）。baseDepth は
 *  GPU に bind せず CPU 専用（drift の currentDepth = baseDepth + sin(...) リファレンス値）。 */
const FLOATS_PER_PARTICLE = 6;

/** 2π 近似。phase 初期化と sin/cos の周期係数に使う（6.2832 固定 = Math.PI*2 にすると見た目が変わる）。 */
const TWO_PI = 6.2832;

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2  a_quadCorner;   // クワッド頂点 (-1..+1)
in vec2  a_position;     // インスタンス: 粒子の screen-space [0,1]
in float a_depth;        // インスタンス: 粒子の depth [0,1]
in float a_lifetime;     // インスタンス: 0..1
in float a_phase;        // インスタンス: 個体差ランダム位相

uniform vec2  u_viewportSize;
uniform float u_particleSize;
uniform float u_yStretch;
uniform vec2  u_offset;
uniform float u_maxDisplacement;

out vec2 v_quadUV;
out float v_depth;
out vec2 v_screenUV;

void main() {
  // 奥の粒子は小さく / 手前は大きく見せる（レンジを広げて存在感差を強化）
  float scale = mix(0.3, 1.4, 1.0 - a_depth) * u_particleSize;
  vec2 corner = a_quadCorner * vec2(1.0, u_yStretch);
  vec2 offsetPx = corner * scale;
  vec2 offsetNDC = offsetPx / u_viewportSize * 2.0;

  // 視差変位: 背景は texture UV を +u_offset*(1-depth)*maxDisp/res でずらすので、
  // 同じ 3D 空間内の点である粒子は screen 上で逆符号にずれる必要がある。
  vec2 parallaxUV = -u_offset * (1.0 - a_depth) * u_maxDisplacement / u_viewportSize;
  vec2 parallaxNDC = parallaxUV * 2.0;

  vec2 ndc = a_position * 2.0 - 1.0;
  gl_Position = vec4(ndc + offsetNDC + parallaxNDC, 0.0, 1.0);

  v_quadUV = a_quadCorner;
  v_depth = a_depth;
  // fragment 側の depth サンプル位置を視差後の screen 位置に揃える
  v_screenUV = a_position + parallaxUV;
  // a_phase / a_lifetime は未参照だと最適化で除去され location=-1 になるためダミー使用
  v_screenUV += vec2(0.0) * a_phase * a_lifetime;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2  v_quadUV;
in float v_depth;
in vec2  v_screenUV;

uniform sampler2D u_depthMap;
uniform vec3  u_particleColor;
uniform vec3  u_fogColor;
uniform float u_fogAlphaMin;
uniform int   u_softEdge;
uniform vec2  u_sourceAspectScale;
uniform float u_edgeZoom;

out vec4 outColor;

void main() {
  float r = length(v_quadUV);
  if (r > 1.0) discard;

  // 背景と同じ座標系で depth を引く: aspect + edgeZoom を適用（視差変位は粒子側には不要）
  vec2 aspectCoord = (v_screenUV - 0.5) * u_sourceAspectScale + 0.5;
  if (aspectCoord.x < 0.0 || aspectCoord.x > 1.0 ||
      aspectCoord.y < 0.0 || aspectCoord.y > 1.0) {
    discard;
  }
  vec2 zoomedCoord = (aspectCoord - 0.5) / u_edgeZoom + 0.5;

  float sceneDepth = texture(u_depthMap, zoomedCoord).r;
  // ハード discard はチラつくため境界 ±0.03 で smoothstep し visibility に（共に 0=手前, 1=奥）
  float visibility = smoothstep(v_depth - 0.03, v_depth + 0.03, sceneDepth);
  if (visibility <= 0.0) discard;

  // 大気遠近フェード: 奥粒を fogColor へ色寄せ(係数 0.7) + alpha を fogAlphaMin まで薄める
  float fogT = clamp(v_depth, 0.0, 1.0);
  float colorMix = fogT * 0.7;
  float depthAlpha = mix(1.0, u_fogAlphaMin, fogT);
  vec3 finalColor = mix(u_particleColor, u_fogColor, colorMix);
  float alpha = (u_softEdge == 1 ? smoothstep(1.0, 0.0, r) : 1.0)
              * visibility * depthAlpha;
  outColor = vec4(finalColor, alpha);
}
`;

const BG_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const BG_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_background;
in vec2 v_texCoord;
out vec4 outColor;
void main() {
  outColor = texture(u_background, v_texCoord);
}
`;

/** 視差パラメータを外から受け取る（ParticleLayer は canvas/sourceWH を持たないため）。
 *  各値は EffectRenderer の同名 uniform と一致させること（ずれると背景と粒子の視差が合わない）。 */
interface RenderParams {
  sourceAspectScale: [number, number];
  edgeZoom: number;
  offset: [number, number];
  maxDisplacement: number;
}

export class ParticleLayer {
  private gl: WebGL2RenderingContext;
  private disposed = false;

  // パーティクル描画プログラム
  private particleProgram: WebGLProgram;
  private uViewportSize: WebGLUniformLocation | null;
  private uParticleSize: WebGLUniformLocation | null;
  private uYStretch: WebGLUniformLocation | null;
  private uDepthMap: WebGLUniformLocation | null;
  private uParticleColor: WebGLUniformLocation | null;
  private uFogColor: WebGLUniformLocation | null;
  private uFogAlphaMin: WebGLUniformLocation | null;
  private uSoftEdge: WebGLUniformLocation | null;
  private uSourceAspectScale: WebGLUniformLocation | null;
  private uEdgeZoom: WebGLUniformLocation | null;
  private uOffset: WebGLUniformLocation | null;
  private uMaxDisplacement: WebGLUniformLocation | null;

  // 背景描画プログラム
  private bgProgram: WebGLProgram;
  private uBackground: WebGLUniformLocation | null;

  // VAO（パーティクル）
  private particleVAO: WebGLVertexArrayObject;
  private quadCornerBuffer: WebGLBuffer;
  private instanceBuffer: WebGLBuffer;
  private cpuParticles: Float32Array | null = null;
  private particleCount = 0;
  private currentType: ParticleType = 'snow';
  /** Z 方向ドリフトの内部時刻（秒）。`update(dt)` で +dt 累算し、
   *  `sin(phase + elapsedSeconds * driftFreq)` の引数に渡す。
   *  累積誤差で sin の精度が落ち始めるのは 10^6 秒オーダーなので clamp/wrap は不要。 */
  private elapsedSeconds = 0;

  // VAO（背景フルスクリーンクワッド）
  private bgVAO: WebGLVertexArrayObject;
  private bgPositionBuffer: WebGLBuffer;
  private bgTexCoordBuffer: WebGLBuffer;

  // 入力
  private depthTexture: WebGLTexture | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    // パーティクル用プログラム
    this.particleProgram = buildProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER, {
      a_quadCorner: 0,
      a_position: 1,
      a_depth: 2,
      a_lifetime: 3,
      a_phase: 4,
    });
    this.uViewportSize = gl.getUniformLocation(this.particleProgram, 'u_viewportSize');
    this.uParticleSize = gl.getUniformLocation(this.particleProgram, 'u_particleSize');
    this.uYStretch = gl.getUniformLocation(this.particleProgram, 'u_yStretch');
    this.uDepthMap = gl.getUniformLocation(this.particleProgram, 'u_depthMap');
    this.uParticleColor = gl.getUniformLocation(this.particleProgram, 'u_particleColor');
    this.uFogColor = gl.getUniformLocation(this.particleProgram, 'u_fogColor');
    this.uFogAlphaMin = gl.getUniformLocation(this.particleProgram, 'u_fogAlphaMin');
    this.uSoftEdge = gl.getUniformLocation(this.particleProgram, 'u_softEdge');
    this.uSourceAspectScale = gl.getUniformLocation(
      this.particleProgram,
      'u_sourceAspectScale',
    );
    this.uEdgeZoom = gl.getUniformLocation(this.particleProgram, 'u_edgeZoom');
    this.uOffset = gl.getUniformLocation(this.particleProgram, 'u_offset');
    this.uMaxDisplacement = gl.getUniformLocation(
      this.particleProgram,
      'u_maxDisplacement',
    );

    // 背景プログラム
    this.bgProgram = buildProgram(gl, BG_VERTEX_SHADER, BG_FRAGMENT_SHADER, {
      a_position: 0,
      a_texCoord: 1,
    });
    this.uBackground = gl.getUniformLocation(this.bgProgram, 'u_background');

    // パーティクル VAO（quadCorner は共有、インスタンス属性は instanceBuffer）
    const particleVAO = gl.createVertexArray();
    const quadCornerBuffer = gl.createBuffer();
    const instanceBuffer = gl.createBuffer();
    if (!particleVAO || !quadCornerBuffer || !instanceBuffer) {
      throw new Error('createBuffer/VAO failed');
    }
    this.particleVAO = particleVAO;
    this.quadCornerBuffer = quadCornerBuffer;
    this.instanceBuffer = instanceBuffer;

    gl.bindVertexArray(particleVAO);

    const quadCorners = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadCornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadCorners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    // 容量はまだ 0。setParticleType の最初の呼び出しで確保される。
    // location 1..4 を有効化しておく
    const stride = FLOATS_PER_PARTICLE * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(4, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // 背景 VAO
    const bgVAO = gl.createVertexArray();
    const bgPositionBuffer = gl.createBuffer();
    const bgTexCoordBuffer = gl.createBuffer();
    if (!bgVAO || !bgPositionBuffer || !bgTexCoordBuffer) {
      throw new Error('createBuffer/VAO failed (bg)');
    }
    this.bgVAO = bgVAO;
    this.bgPositionBuffer = bgPositionBuffer;
    this.bgTexCoordBuffer = bgTexCoordBuffer;
    gl.bindVertexArray(bgVAO);
    const bgPositions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    // compositeFbo は FBO 書き込みなので UNPACK_FLIP_Y の影響を受けない。EffectRenderer 最終パスと
    // 同じ glsl/VAO のため「画面上端 = テクスチャ v=1」。よって v は 1.0-y を取らず素直に対応させる。
    const bgTexCoords = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, bgPositions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgTexCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, bgTexCoords, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  setDepthTexture(tex: WebGLTexture | null): void {
    this.depthTexture = tex;
  }

  /** 粒子種別 + 個数を設定（個数変更で CPU/GPU バッファ再 alloc、種別 or 個数変更で全粒子再生成）。 */
  setParticleType(type: ParticleType, count: number): void {
    const safeCount = Math.max(1, Math.floor(count));
    const typeChanged = type !== this.currentType;
    const countChanged = safeCount !== this.particleCount;
    this.currentType = type;
    this.particleCount = safeCount;

    if (countChanged || !this.cpuParticles) {
      this.cpuParticles = new Float32Array(safeCount * FLOATS_PER_PARTICLE);
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.cpuParticles.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.initParticles();
      return;
    }
    if (typeChanged) {
      // 種別変更時は乱数バラつきを直すために初期化し直す
      this.initParticles();
    }
  }

  /** 全粒子を画面上端から段階的に再生成（自然に降ってくる初期分布） */
  private initParticles(): void {
    if (!this.cpuParticles) return;
    const profile = PROFILES[this.currentType];
    const arr = this.cpuParticles;
    for (let i = 0; i < this.particleCount; i++) {
      const o = i * FLOATS_PER_PARTICLE;
      arr[o + 0] = Math.random();              // pos.x
      arr[o + 1] = Math.random();              // pos.y（最初は全画面に散らばらせる）
      // depth を種別分布からサンプル。baseDepth は保持、currentDepth は drift で毎フレーム上書き
      const baseDepth = sampleDepth(profile.depthBias);
      arr[o + 2] = baseDepth;                  // currentDepth（初期値）
      arr[o + 3] = Math.random();              // lifetime
      arr[o + 4] = Math.random() * TWO_PI;     // phase (0..2π)
      arr[o + 5] = baseDepth;                  // baseDepth（CPU 専用スロット）
    }
  }

  /** CPU 側の粒子状態を更新し GPU バッファへ転送する（dt = 前フレームからの経過秒）。 */
  update(
    dt: number,
    params: { fallSpeed: number; windSway: number },
  ): void {
    if (!this.cpuParticles || this.particleCount === 0) return;
    const profile = PROFILES[this.currentType];
    const arr = this.cpuParticles;
    const speedScale = profile.speedFactor;
    const lifeStep = dt / profile.lifetime;
    this.elapsedSeconds += dt;
    const driftAmp = profile.driftAmp;
    const driftFreq = profile.driftFreq;
    const driftT = this.elapsedSeconds * driftFreq;

    for (let i = 0; i < this.particleCount; i++) {
      const o = i * FLOATS_PER_PARTICLE;
      // Y は「上 (NDC y=+1, screen-space y=1) → 下 (0)」に向けて落ちる
      arr[o + 1] -= params.fallSpeed * dt * speedScale;
      // 横揺れ（蛍は上下にもゆらぐ）
      const phase = arr[o + 4];
      arr[o + 0] += Math.sin(phase + arr[o + 3] * TWO_PI) *
        params.windSway * dt * profile.swayFactor * 0.1;
      if (this.currentType === 'firefly') {
        arr[o + 1] += Math.cos(phase * 1.3 + arr[o + 3] * TWO_PI) *
          params.windSway * dt * profile.swayFactor * 0.1;
      }
      if (arr[o + 0] < 0) arr[o + 0] += 1;
      if (arr[o + 0] > 1) arr[o + 0] -= 1;

      arr[o + 3] += lifeStep;

      // 下端到達 / 寿命切れで再生成
      if (arr[o + 1] < -0.05 || arr[o + 3] > 1) {
        arr[o + 0] = Math.random();
        // firefly は空中に現れる性質なので再生成 y はランダム、他種別は y=1.05 固定で上から降らせる
        arr[o + 1] = this.currentType === 'firefly' ? Math.random() : 1.05;
        const newBase = sampleDepth(profile.depthBias);
        arr[o + 2] = newBase;
        arr[o + 3] = 0;
        arr[o + 4] = Math.random() * TWO_PI;
        arr[o + 5] = newBase;
      }

      // Z ドリフト: baseDepth に sin ゆらぎを乗せ currentDepth に書き戻す。
      // [0,1] 外は smoothstep の境界判定が極端化するので clamp。
      const baseDepth = arr[o + 5];
      const drifted = baseDepth + Math.sin(arr[o + 4] + driftT) * driftAmp;
      arr[o + 2] = drifted < 0.0 ? 0.0 : drifted > 1.0 ? 1.0 : drifted;
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** 背景（compositeFbo）→ パーティクルの順で描画（呼び出し側で default framebuffer に bind 済み前提）。 */
  render(
    backgroundTexture: WebGLTexture,
    viewportSize: [number, number],
    params: RenderParams,
  ): void {
    if (this.disposed) return;
    const gl = this.gl;
    const profile = PROFILES[this.currentType];

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, viewportSize[0], viewportSize[1]);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // 1) 背景クワッド（ブレンド無効）
    gl.disable(gl.BLEND);
    gl.useProgram(this.bgProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
    if (this.uBackground) gl.uniform1i(this.uBackground, 0);
    gl.bindVertexArray(this.bgVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2) パーティクル
    if (!this.cpuParticles || this.particleCount === 0 || !this.depthTexture) {
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return;
    }

    gl.enable(gl.BLEND);
    if (profile.blend === 'additive') {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    gl.useProgram(this.particleProgram);
    if (this.uViewportSize) {
      gl.uniform2f(this.uViewportSize, viewportSize[0], viewportSize[1]);
    }
    if (this.uParticleSize) gl.uniform1f(this.uParticleSize, profile.size);
    if (this.uYStretch) gl.uniform1f(this.uYStretch, profile.yStretch);
    if (this.uParticleColor) {
      gl.uniform3f(
        this.uParticleColor,
        profile.color[0],
        profile.color[1],
        profile.color[2],
      );
    }
    if (this.uFogColor) {
      gl.uniform3f(
        this.uFogColor,
        profile.fogColor[0],
        profile.fogColor[1],
        profile.fogColor[2],
      );
    }
    if (this.uFogAlphaMin) gl.uniform1f(this.uFogAlphaMin, profile.fogAlphaMin);
    if (this.uSoftEdge) gl.uniform1i(this.uSoftEdge, profile.softEdge);
    if (this.uSourceAspectScale) {
      gl.uniform2f(
        this.uSourceAspectScale,
        params.sourceAspectScale[0],
        params.sourceAspectScale[1],
      );
    }
    if (this.uEdgeZoom) gl.uniform1f(this.uEdgeZoom, params.edgeZoom);
    if (this.uOffset) gl.uniform2f(this.uOffset, params.offset[0], params.offset[1]);
    if (this.uMaxDisplacement) {
      gl.uniform1f(this.uMaxDisplacement, params.maxDisplacement);
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    if (this.uDepthMap) gl.uniform1i(this.uDepthMap, 1);

    gl.bindVertexArray(this.particleVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.particleCount);

    // ブレンド設定は後段に影響しないようリセット
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.deleteProgram(this.particleProgram);
    gl.deleteProgram(this.bgProgram);
    gl.deleteVertexArray(this.particleVAO);
    gl.deleteVertexArray(this.bgVAO);
    gl.deleteBuffer(this.quadCornerBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteBuffer(this.bgPositionBuffer);
    gl.deleteBuffer(this.bgTexCoordBuffer);
    this.cpuParticles = null;
    this.depthTexture = null;
  }
}
