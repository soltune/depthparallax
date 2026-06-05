/**
 * 3D メッシュ・オービットビュー用レンダラ。EffectRenderer とは独立した WebGL2 コンテキストで、
 * 深度マップで凹凸を付けたグリッドメッシュをカメラ姿勢に応じて描く（viewMode==='orbit' 時のみ）。
 *
 * 不変条件:
 * - 画像・深度マップとも UNPACK_FLIP_Y_WEBGL=true（TextureManager 内で適用）
 * - 深度値は depthUtils.normalize 済み（0=手前 / 1=奥）。頂点シェーダーで Z 変位に変換
 * - dispose 末尾で loseContext() を明示呼出し（iOS のコンテキスト割当上限対策）
 */

import type { OrbitState } from '../types';
import { lookAt, multiply, perspective, type Mat4 } from '../utils/matrix';
import { imageAspectScale } from './aspect';
import { buildProgram } from './glProgram';
import {
  type DepthTextureSet,
  disposeDepthTextures,
  uploadDepthTextures,
} from './TextureManager';

/** グリッドメッシュの分割数。Z 変位の細かさのみに効く内部値。Depth Anything の深度マップが
 *  低周波なため 64 で十分（96 = 9409 頂点との体感差はほぼ無い）。 */
const MESH_DENSITY = 64;

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_uv;

uniform mat4 u_mvp;
uniform sampler2D u_depthMap;
uniform vec2 u_sourceAspectScale; // (texImgW, texImgH) = (sourceW/maxSide, sourceH/maxSide)
uniform float u_depthScale;
uniform float u_edgeFadeWidth;    // a_uv 端からの depth クランプ幅（0..0.5）

out vec2 v_uv;
out float v_depth;

void main() {
  // メッシュは画像アスペクト比の長方形。u_sourceAspectScale（max 1.0、短辺<1）を掛けて整形。
  vec2 aspectXY = a_position * u_sourceAspectScale;

  // 画像サンプル座標: a_uv を深度マップ内の有効領域へ圧縮
  vec2 imageUv = (a_uv - 0.5) * u_sourceAspectScale + 0.5;

  // 最外周 fadeWidth は内側へクランプ: Depth Anything が画像端で出す極端な depth を読まず、
  // 端の頂点を内側の妥当な depth に倣わせる（端を Z=0 に倒さない）。
  float fade = max(u_edgeFadeWidth, 0.0001);
  vec2 clampedUv = clamp(a_uv, vec2(fade), vec2(1.0 - fade));
  vec2 depthUv = (clampedUv - 0.5) * u_sourceAspectScale + 0.5;

  // 頂点シェーダーで depth サンプル（VTF）。linear 非対応なら NEAREST（TextureManager で吸収）
  float depth = texture(u_depthMap, depthUv).r;

  // 0=手前 / 1=奥 を Z へ変位。手前 +Z / 奥 -Z にしてカメラを +Z 側に置く
  float z = (0.5 - depth) * u_depthScale;

  gl_Position = u_mvp * vec4(aspectXY, z, 1.0);
  v_uv = imageUv;
  v_depth = depth;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_depth;
uniform sampler2D u_image;

out vec4 outColor;

void main() {
  outColor = texture(u_image, v_uv);
}
`;

/** SceneRenderer のメッシュは a_position=0 / a_uv=1 で固定（VAO 構築側と一致させる）。 */
const MESH_ATTRIBS: Record<string, number> = { a_position: 0, a_uv: 1 };

interface MeshBuffers {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  indexCount: number;
  density: number;
}

/**
 * 密度 N のグリッドメッシュ。頂点 (N+1)²（各 [a_position.xy, a_uv.xy]）、インデックス 6·N²。
 * N=96 でも 9409 頂点なので Uint16 で足りる。
 */
function buildMesh(
  gl: WebGL2RenderingContext,
  density: number,
): MeshBuffers {
  const N = density;
  const verts = (N + 1) * (N + 1);
  const interleaved = new Float32Array(verts * 4);
  let p = 0;
  for (let j = 0; j <= N; j++) {
    const v = j / N;
    const y = v * 2 - 1; // [0, 1] → [-1, +1]
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = u * 2 - 1;
      interleaved[p++] = x;
      interleaved[p++] = y;
      interleaved[p++] = u;
      interleaved[p++] = v;
    }
  }

  const indexCount = 6 * N * N;
  const indices = new Uint16Array(indexCount);
  let q = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const i0 = j * (N + 1) + i;
      const i1 = i0 + 1;
      const i2 = i0 + (N + 1);
      const i3 = i2 + 1;
      indices[q++] = i0; indices[q++] = i1; indices[q++] = i2;
      indices[q++] = i2; indices[q++] = i1; indices[q++] = i3;
    }
  }

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  if (!vao || !vbo || !ibo) {
    if (vao) gl.deleteVertexArray(vao);
    if (vbo) gl.deleteBuffer(vbo);
    if (ibo) gl.deleteBuffer(ibo);
    throw new Error('SceneRenderer: createBuffer/VAO failed');
  }

  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
  const stride = 4 * 4; // 4 floats × 4 bytes
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 2 * 4);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

  return { vao, vbo, ibo, indexCount, density };
}

function disposeMesh(gl: WebGL2RenderingContext, mesh: MeshBuffers): void {
  gl.deleteBuffer(mesh.vbo);
  gl.deleteBuffer(mesh.ibo);
  gl.deleteVertexArray(mesh.vao);
}

export interface RenderParams {
  depthScale: number;
  /** a_uv 端からのフェード幅。 0..0.5 程度。 depth 推定の不安定な画像端の Z 変位を抑える。 */
  edgeFadeWidth: number;
}

export class SceneRenderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  private program!: WebGLProgram;
  private uMvp!: WebGLUniformLocation | null;
  private uDepthMap!: WebGLUniformLocation | null;
  private uImage!: WebGLUniformLocation | null;
  private uSourceAspectScale!: WebGLUniformLocation | null;
  private uDepthScale!: WebGLUniformLocation | null;
  private uEdgeFadeWidth!: WebGLUniformLocation | null;

  private mesh: MeshBuffers | null = null;

  private textures: DepthTextureSet | null = null;

  private drawingWidth = 0;
  private drawingHeight = 0;

  private floatLinear: boolean;
  private loseContextExt: WEBGL_lose_context | null;
  private contextLost = false;
  private disposed = false;

  /** 行列計算用の再利用バッファ（毎フレームのアロケーション回避） */
  private readonly projMat: Mat4 = new Float32Array(16);
  private readonly viewMat: Mat4 = new Float32Array(16);
  private readonly mvpMat: Mat4 = new Float32Array(16);

  /** context restored 時に ViewerDispatch がテクスチャを再アップロードするためのコールバック */
  private onContextRestoredCallback: (() => void) | null = null;

  private readonly handleContextLost: (event: Event) => void;
  private readonly handleContextRestored: () => void;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: true, // メッシュの depth-test に必須
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 が利用できません');
    this.gl = gl;
    this.canvas = canvas;

    // VTF サポート確認。MAX_VERTEX_TEXTURE_IMAGE_UNITS=0 だと頂点で texture() が引けずメッシュが平坦化
    const vtfUnits = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number;
    if (typeof vtfUnits === 'number' && vtfUnits <= 0) {
      throw new Error(
        `SceneRenderer: Vertex Texture Fetch 非対応（MAX_VERTEX_TEXTURE_IMAGE_UNITS=${vtfUnits}）`,
      );
    }

    this.floatLinear = gl.getExtension('OES_texture_float_linear') !== null;
    this.loseContextExt = gl.getExtension(
      'WEBGL_lose_context',
    ) as WEBGL_lose_context | null;

    this.drawingWidth = gl.drawingBufferWidth;
    this.drawingHeight = gl.drawingBufferHeight;

    this.handleContextLost = (event: Event) => {
      event.preventDefault();
      this.contextLost = true;
      this.program = null as unknown as WebGLProgram;
      this.mesh = null;
      this.textures = null;
    };
    this.handleContextRestored = () => {
      if (this.disposed) return;
      this.contextLost = false;
      this.loseContextExt = this.gl.getExtension(
        'WEBGL_lose_context',
      ) as WEBGL_lose_context | null;
      this.rehydrate();
      this.onContextRestoredCallback?.();
    };
    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    canvas.addEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
      false,
    );

    this.buildGpuResources();
  }

  private buildGpuResources(): void {
    const gl = this.gl;

    this.program = buildProgram(
      gl,
      VERTEX_SHADER,
      FRAGMENT_SHADER,
      MESH_ATTRIBS,
      'SceneRenderer',
    );

    this.uMvp = gl.getUniformLocation(this.program, 'u_mvp');
    this.uDepthMap = gl.getUniformLocation(this.program, 'u_depthMap');
    this.uImage = gl.getUniformLocation(this.program, 'u_image');
    this.uSourceAspectScale = gl.getUniformLocation(
      this.program,
      'u_sourceAspectScale',
    );
    this.uDepthScale = gl.getUniformLocation(this.program, 'u_depthScale');
    this.uEdgeFadeWidth = gl.getUniformLocation(this.program, 'u_edgeFadeWidth');

    this.mesh = buildMesh(gl, MESH_DENSITY);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 1);
    gl.viewport(0, 0, this.drawingWidth, this.drawingHeight);
  }

  private rehydrate(): void {
    this.buildGpuResources();
    // テクスチャは ViewerDispatch 側で再アップロード
  }

  setOnContextRestored(cb: (() => void) | null): void {
    this.onContextRestoredCallback = cb;
  }

  /** 元画像と深度マップを GPU テクスチャとしてアップロードする。 */
  setTextures(
    image: ImageData,
    depth: Float32Array,
    depthWidth: number,
    depthHeight: number,
    sourceWidth: number,
    sourceHeight: number,
  ): void {
    if (this.disposed) throw new Error('SceneRenderer is disposed');
    if (this.contextLost) return;
    const gl = this.gl;

    if (this.textures) {
      disposeDepthTextures(gl, this.textures);
      this.textures = null;
    }

    this.textures = uploadDepthTextures(
      gl,
      image,
      depth,
      depthWidth,
      depthHeight,
      sourceWidth,
      sourceHeight,
      this.floatLinear,
    );
  }

  resize(displayWidth: number, displayHeight: number, dpr: number): void {
    if (this.disposed) return;
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const w = Math.max(1, Math.floor(displayWidth * dpr));
    const h = Math.max(1, Math.floor(displayHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    this.drawingWidth = w;
    this.drawingHeight = h;
    if (this.contextLost) return;
    gl.viewport(0, 0, w, h);
  }

  /** 1 フレーム描画（orbit = useOrbit の yaw/pitch/distance）。 */
  render(orbit: OrbitState, params: RenderParams): void {
    if (this.disposed) return;
    if (this.contextLost) return;
    const gl = this.gl;
    const mesh = this.mesh;
    const textures = this.textures;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.drawingWidth, this.drawingHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!mesh || !textures || !this.program) return;

    // カメラ位置: yaw=pitch=0 で +Z 正面、distance だけ離れた点
    const cp = Math.cos(orbit.pitch);
    const eye: [number, number, number] = [
      cp * Math.sin(orbit.yaw) * orbit.distance,
      Math.sin(orbit.pitch) * orbit.distance,
      cp * Math.cos(orbit.yaw) * orbit.distance,
    ];
    const aspect =
      this.drawingHeight > 0 ? this.drawingWidth / this.drawingHeight : 1;
    perspective(Math.PI / 4, aspect, 0.1, 10, this.projMat);
    lookAt(eye, [0, 0, 0], [0, 1, 0], this.viewMat);
    multiply(this.mvpMat, this.projMat, this.viewMat);

    const [sx, sy] = imageAspectScale(textures.sourceWidth, textures.sourceHeight);

    gl.useProgram(this.program);
    gl.bindVertexArray(mesh.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.image);
    if (this.uImage) gl.uniform1i(this.uImage, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures.depth);
    if (this.uDepthMap) gl.uniform1i(this.uDepthMap, 1);

    if (this.uMvp) gl.uniformMatrix4fv(this.uMvp, false, this.mvpMat);
    if (this.uSourceAspectScale) gl.uniform2f(this.uSourceAspectScale, sx, sy);
    if (this.uDepthScale) gl.uniform1f(this.uDepthScale, params.depthScale);
    if (this.uEdgeFadeWidth) gl.uniform1f(this.uEdgeFadeWidth, params.edgeFadeWidth);

    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);

    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** リソース解放（末尾で loseContext() を明示呼出し、iOS のコンテキスト上限枯渇を回避）。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.canvas.removeEventListener(
      'webglcontextlost',
      this.handleContextLost,
      false,
    );
    this.canvas.removeEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
      false,
    );
    this.onContextRestoredCallback = null;

    const gl = this.gl;

    if (!this.contextLost) {
      if (this.textures) {
        disposeDepthTextures(gl, this.textures);
        this.textures = null;
      }
      if (this.mesh) {
        disposeMesh(gl, this.mesh);
        this.mesh = null;
      }
      if (this.program) {
        gl.deleteProgram(this.program);
      }
    }

    // iOS Safari は GC 待ちだと context 数が 8〜16 上限を超えるため明示解放する。
    // ただし dev の StrictMode double-mount では同じ canvas に 2 回目の SceneRenderer が同 tick 内で
    // 作られ、loseContext すると 2 回目の getContext が lost を返しコンパイル失敗する。production は
    // double-mount が無く dispatcher 切替時は canvas ごと unmount されるため安全。
    if (this.loseContextExt && import.meta.env.PROD) {
      try {
        this.loseContextExt.loseContext();
      } catch {
        // 既に lost 状態ならスローする実装があるので握りつぶす
      }
    }
  }
}
