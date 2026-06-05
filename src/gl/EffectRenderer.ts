/**
 * 汎用 WebGL2 レンダラー。EffectDescriptor の passes を順に実行する（Strategy パターン）。
 *
 * 不変条件:
 * - 画像・深度マップ両方のアップロードで UNPACK_FLIP_Y_WEBGL=true（texCoords 側の反転は禁止）
 * - 深度値は depthUtils.normalize 済み（0=手前, 1=奥）
 * - アスペクト補正は uniform u_sourceAspectScale
 *
 * テクスチャユニット: TEXTURE0=u_image / TEXTURE1=u_depthMap / TEXTURE2=u_previousPass
 */
import type { EffectDescriptor, EffectType, PassDescriptor } from '../types';
import { computeAspectScale } from './aspect.ts';
import { buildProgram } from './glProgram.ts';
import { EFFECT_DESCRIPTORS } from './effects/index.ts';
import {
  COMMON_UNIFORM_NAMES,
  VERTEX_SHADER_FULLSCREEN,
} from './shaders/common.ts';
import {
  type DepthTextureSet,
  disposeDepthTextures,
  uploadDepthTextures,
} from './TextureManager.ts';

interface Framebuffer {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

type ParamValue = number | number[] | boolean;

/** EffectRenderer の全プログラムは fullscreen quad の a_position=0 / a_texCoord=1 で固定。 */
const FULLSCREEN_ATTRIBS: Record<string, number> = { a_position: 0, a_texCoord: 1 };

function cacheUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly string[],
): Map<string, WebGLUniformLocation> {
  const cache = new Map<string, WebGLUniformLocation>();
  for (const name of names) {
    const loc = gl.getUniformLocation(program, name);
    if (loc !== null) cache.set(name, loc);
  }
  return cache;
}

export class EffectRenderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  private programs: Map<EffectType, WebGLProgram[]> = new Map();
  private uniformLocations: Map<WebGLProgram, Map<string, WebGLUniformLocation>> = new Map();

  private textures: DepthTextureSet | null = null;

  /** ピンポン用 FBO（resize で再作成） */
  private fbos: [Framebuffer, Framebuffer] | null = null;

  /**
   * 3 枚目の合成用 FBO。setCompositeMode(true) のとき最終パスの 'screen' 出力を
   * ここに振り替え、ParticleLayer が背景として読みに来る。
   */
  private compositeFbo: Framebuffer | null = null;
  private compositeEnabled = false;
  /** composite mode で 1 回以上 render したか（getCompositeTexture の有効性判定用） */
  private compositeRendered = false;

  /** フルスクリーンクワッドの VAO / バッファ（context restore で再構築されるため definite-assignment） */
  private quadVAO!: WebGLVertexArrayObject;
  private positionBuffer!: WebGLBuffer;
  private texCoordBuffer!: WebGLBuffer;

  private effectDescriptors: readonly EffectDescriptor[];
  private currentEffect: EffectType;
  private currentParams: Map<EffectType, Map<string, ParamValue>> = new Map();

  /** 内部解像度（drawingBufferWidth/Height と同期する想定） */
  private drawingWidth = 0;
  private drawingHeight = 0;

  /** OES_texture_float_linear 拡張対応可否 */
  private floatLinear: boolean;

  /** WEBGL_lose_context 拡張（手動 lose/restore 用 / null 許容） */
  private loseContextExt: WEBGL_lose_context | null;

  /** context loss 中フラグ。true の間は render/setTextures/resize は no-op */
  private contextLost = false;

  /** context restored 後に呼ばれるコールバック（ViewerDispatch がテクスチャ再アップロードに使う） */
  private onContextRestoredCallback: (() => void) | null = null;

  /** canvas に bind 済みのイベントハンドラ（dispose で removeEventListener するため保持） */
  private readonly handleContextLost: (event: Event) => void;
  private readonly handleContextRestored: () => void;

  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 が利用できません');
    this.gl = gl;
    this.canvas = canvas;

    this.floatLinear = gl.getExtension('OES_texture_float_linear') !== null;
    this.loseContextExt = gl.getExtension('WEBGL_lose_context') as WEBGL_lose_context | null;

    this.effectDescriptors = EFFECT_DESCRIPTORS;
    if (this.effectDescriptors.length === 0) {
      throw new Error('EFFECT_DESCRIPTORS が空です');
    }
    this.currentEffect = this.effectDescriptors[0].type;

    // エフェクトごとのパラメータデフォルト値を初期化（プログラムとは独立、context loss でも保持）
    for (const desc of this.effectDescriptors) {
      const paramMap = new Map<string, ParamValue>();
      for (const p of desc.params) {
        paramMap.set(p.name, p.default);
      }
      this.currentParams.set(desc.type, paramMap);
    }

    this.drawingWidth = gl.drawingBufferWidth;
    this.drawingHeight = gl.drawingBufferHeight;

    this.handleContextLost = (event: Event) => {
      event.preventDefault();
      this.contextLost = true;
      // GPU 側は解放済み。delete は呼ばず参照だけ捨てて GC に回す。

      this.programs.clear();
      this.uniformLocations.clear();
      this.textures = null;
      this.fbos = null;
      this.compositeFbo = null;
      this.compositeRendered = false;
    };
    this.handleContextRestored = () => {
      if (this.disposed) return;
      this.contextLost = false;
      // 拡張ハンドルは context loss で無効化される実装があるため再取得
      this.loseContextExt = this.gl.getExtension('WEBGL_lose_context') as WEBGL_lose_context | null;
      this.rehydrate();
      this.onContextRestoredCallback?.();
    };
    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.buildGpuResources();
  }

  /**
   * プログラム・VAO・バッファを (再)構築する。
   * - コンストラクタ初期化と context restored の rehydrate から共有
   * - FBO は drawingWidth/Height に依存するため resize 経由で別途構築
   */
  private buildGpuResources(): void {
    const gl = this.gl;

    // 全エフェクトのプログラムを事前コンパイル + uniform location キャッシュ
    for (const desc of this.effectDescriptors) {
      const compiledPasses: WebGLProgram[] = [];
      for (const pass of desc.passes) {
        const program = buildProgram(
          gl,
          VERTEX_SHADER_FULLSCREEN,
          pass.fragmentShader,
          FULLSCREEN_ATTRIBS,
        );
        compiledPasses.push(program);
        const names = [
          ...COMMON_UNIFORM_NAMES,
          ...desc.params.map((p) => `u_${p.name}`),
        ];
        this.uniformLocations.set(program, cacheUniformLocations(gl, program, names));
      }
      this.programs.set(desc.type, compiledPasses);
    }

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    this.quadVAO = vao;
    gl.bindVertexArray(vao);

    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    // UNPACK_FLIP_Y_WEBGL で Y 軸を吸収するため texCoord 側は反転しない
    const texCoords = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ]);

    const positionBuffer = gl.createBuffer();
    const texCoordBuffer = gl.createBuffer();
    if (!positionBuffer || !texCoordBuffer) throw new Error('createBuffer failed');
    this.positionBuffer = positionBuffer;
    this.texCoordBuffer = texCoordBuffer;

    // a_position は location=0、a_texCoord は location=1 に固定（bindAttribLocation 済み）
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    gl.viewport(0, 0, this.drawingWidth, this.drawingHeight);
    gl.clearColor(0, 0, 0, 1);
  }

  /**
   * context restored 後にプログラム・VAO・バッファ・FBO を再構築する。
   * テクスチャは ViewerDispatch 側（onContextRestoredCallback 経由）で再アップロード。
   */
  private rehydrate(): void {
    this.buildGpuResources();
    if (this.drawingWidth > 0 && this.drawingHeight > 0) {
      this.fbos = [
        createFramebuffer(this.gl, this.drawingWidth, this.drawingHeight),
        createFramebuffer(this.gl, this.drawingWidth, this.drawingHeight),
      ];
      if (this.compositeEnabled) {
        this.compositeFbo = createFramebuffer(this.gl, this.drawingWidth, this.drawingHeight);
      }
    }
    // restored 後は前フレームの compositeFbo 内容が無い扱い
    this.compositeRendered = false;
  }

  /** context restored 後に呼ぶコールバックを登録（ViewerDispatch が setTextures() で再アップロード）。 */
  setOnContextRestored(cb: (() => void) | null): void {
    this.onContextRestoredCallback = cb;
  }

  /** dev 用: context loss を再現（WEBGL_lose_context 未対応なら警告して no-op）。 */
  simulateContextLoss(): void {
    if (!this.loseContextExt) {
      console.warn('[EffectRenderer] WEBGL_lose_context not available');
      return;
    }
    this.loseContextExt.loseContext();
  }

  simulateContextRestore(): void {
    if (!this.loseContextExt) {
      console.warn('[EffectRenderer] WEBGL_lose_context not available');
      return;
    }
    this.loseContextExt.restoreContext();
  }

  /** 元画像と深度マップを GPU テクスチャへアップロード（画像・深度とも UNPACK_FLIP_Y_WEBGL 適用）。 */
  setTextures(
    image: ImageData,
    depth: Float32Array,
    depthWidth: number,
    depthHeight: number,
    sourceWidth: number,
    sourceHeight: number,
  ): void {
    if (this.disposed) throw new Error('EffectRenderer is disposed');
    // context loss 中は GPU リソースを作れないので skip。
    // restored 後の onContextRestoredCallback 経路で ViewerDispatch が再アップロードする。
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

  /** 使用するエフェクトを切り替える（プログラムは事前コンパイル済みなので参照切替のみ） */
  setEffect(type: EffectType): void {
    // context loss 中も切替を受けるため programs（loss でクリア）でなく descriptors で検証
    const known = this.effectDescriptors.some((d) => d.type === type);
    if (!known) {
      console.warn(`[EffectRenderer] unknown effect type: ${type}`);
      return;
    }
    this.currentEffect = type;
  }

  /** 現在のエフェクトの個別パラメータを更新する（未知キーは警告して無視）。 */
  setEffectParams(params: Record<string, ParamValue>): void {
    const paramMap = this.currentParams.get(this.currentEffect);
    if (!paramMap) return;
    const desc = this.effectDescriptors.find((d) => d.type === this.currentEffect);
    if (!desc) return;
    const knownNames = new Set(desc.params.map((p) => p.name));
    for (const [k, v] of Object.entries(params)) {
      if (!knownNames.has(k)) {
        console.warn(`[EffectRenderer] unknown param "${k}" for effect "${this.currentEffect}"`);
        continue;
      }
      paramMap.set(k, v);
    }
  }

  /**
   * 合成モードの切替。true で次回 render() の最終パス 'screen' 出力を compositeFbo へ振り替え、
   * ParticleLayer が getCompositeTexture() で参照する。false で default framebuffer 出力に戻し FBO 破棄。
   */
  setCompositeMode(enabled: boolean): void {
    if (this.compositeEnabled === enabled) return;
    this.compositeEnabled = enabled;
    if (!enabled) {
      if (this.compositeFbo) {
        const gl = this.gl;
        if (!this.contextLost) {
          gl.deleteFramebuffer(this.compositeFbo.fbo);
          gl.deleteTexture(this.compositeFbo.texture);
        }
        this.compositeFbo = null;
      }
      this.compositeRendered = false;
      return;
    }
    if (
      !this.contextLost &&
      this.drawingWidth > 0 &&
      this.drawingHeight > 0 &&
      !this.compositeFbo
    ) {
      this.compositeFbo = createFramebuffer(this.gl, this.drawingWidth, this.drawingHeight);
    }
    this.compositeRendered = false;
  }

  /** composite mode で書いた最終パス結果。setCompositeMode(true) + 1 回以上 render 後に有効、他は null。 */
  getCompositeTexture(): WebGLTexture | null {
    if (!this.compositeEnabled || !this.compositeFbo || !this.compositeRendered) {
      return null;
    }
    return this.compositeFbo.texture;
  }

  /**
   * 1 フレーム描画（現エフェクトの passes を順に実行、共通 + 個別 uniform を毎フレーム書き込み）。
   * @param timeSeconds マウントからの経過秒（u_time）
   */
  render(
    offsetX: number,
    offsetY: number,
    maxDisplacement: number,
    edgeZoom: number,
    timeSeconds: number,
  ): void {
    if (this.disposed) return;
    if (this.contextLost) return;
    const gl = this.gl;
    const textures = this.textures;

    const desc = this.effectDescriptors.find((d) => d.type === this.currentEffect);
    const programs = this.programs.get(this.currentEffect);
    if (!desc || !programs) return;

    if (!textures) {
      gl.viewport(0, 0, this.drawingWidth, this.drawingHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    gl.bindVertexArray(this.quadVAO);

    const paramMap = this.currentParams.get(this.currentEffect);
    const [sx, sy] = computeAspectScale(
      textures.sourceWidth,
      textures.sourceHeight,
      this.drawingWidth,
      this.drawingHeight,
    );

    // ピンポン: output:'fbo' の書き先を 0/1 交互に切替。'previousPass' は最後に書いた FBO を読む。
    // lastWrittenFbo の更新は drawArrays の後（先に更新すると現書き込み先を読んで feedback loop = 全 0）。
    let writeFbo = 0;
    let lastWrittenFbo = -1;

    // composite mode 有効時は最終パスの 'screen' のみ compositeFbo へ振り替える
    // （中間 'fbo' を 3 枚目に流すと previousPass の解釈が壊れるため据え置き）。
    const lastPassIndex = desc.passes.length - 1;
    const useCompositeRedirect =
      this.compositeEnabled && this.compositeFbo !== null;

    for (let i = 0; i < desc.passes.length; i++) {
      const pass = desc.passes[i];
      const program = programs[i];
      const uniforms = this.uniformLocations.get(program);
      if (!uniforms) continue;

      const isLastPass = i === lastPassIndex;
      const redirectToComposite =
        isLastPass && useCompositeRedirect && pass.output === 'screen';

      let outputWidth: number;
      let outputHeight: number;
      const currentWriteFbo = pass.output === 'fbo' ? writeFbo : -1;
      if (currentWriteFbo >= 0) {
        if (!this.fbos) throw new Error('FBO 未初期化（resize を先に呼ぶこと）');
        const fb = this.fbos[currentWriteFbo];
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
        outputWidth = fb.width;
        outputHeight = fb.height;
      } else if (redirectToComposite && this.compositeFbo) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.compositeFbo.fbo);
        outputWidth = this.compositeFbo.width;
        outputHeight = this.compositeFbo.height;
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        outputWidth = this.drawingWidth;
        outputHeight = this.drawingHeight;
      }
      gl.viewport(0, 0, outputWidth, outputHeight);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      bindPassInputs(gl, pass, uniforms, textures, this.fbos, lastWrittenFbo);

      // u_resolution は書き込み先 FBO の解像度
      setIfPresent(uniforms, 'u_offset', (l) => gl.uniform2f(l, offsetX, offsetY));
      setIfPresent(uniforms, 'u_maxDisplacement', (l) => gl.uniform1f(l, maxDisplacement));
      setIfPresent(uniforms, 'u_resolution', (l) => gl.uniform2f(l, outputWidth, outputHeight));
      setIfPresent(uniforms, 'u_edgeZoom', (l) => gl.uniform1f(l, edgeZoom));
      setIfPresent(uniforms, 'u_sourceAspectScale', (l) => gl.uniform2f(l, sx, sy));
      setIfPresent(uniforms, 'u_time', (l) => gl.uniform1f(l, timeSeconds));

      if (paramMap) {
        for (const p of desc.params) {
          const loc = uniforms.get(`u_${p.name}`);
          if (!loc) continue;
          const v = paramMap.get(p.name) ?? p.default;
          writeParamUniform(gl, loc, p.type, v);
        }
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // ピンポン更新は drawArrays の後（前述の feedback loop 回避）
      if (currentWriteFbo >= 0) {
        lastWrittenFbo = currentWriteFbo;
        writeFbo = 1 - writeFbo;
      }
    }

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (useCompositeRedirect) {
      this.compositeRendered = true;
    }
  }

  /** canvas 表示サイズ（CSS px）と dpr から内部解像度・FBO サイズを更新する。 */
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

    // context loss 中は FBO 作成不可。サイズだけ覚えておき、restored 時の rehydrate で構築する。
    if (this.contextLost) return;

    gl.viewport(0, 0, w, h);

    if (this.fbos) {
      for (const fb of this.fbos) {
        gl.deleteFramebuffer(fb.fbo);
        gl.deleteTexture(fb.texture);
      }
      this.fbos = null;
    }
    this.fbos = [createFramebuffer(gl, w, h), createFramebuffer(gl, w, h)];

    if (this.compositeFbo) {
      gl.deleteFramebuffer(this.compositeFbo.fbo);
      gl.deleteTexture(this.compositeFbo.texture);
      this.compositeFbo = null;
    }
    if (this.compositeEnabled) {
      this.compositeFbo = createFramebuffer(gl, w, h);
    }
    this.compositeRendered = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored, false);
    this.onContextRestoredCallback = null;

    // context lost 中の dispose: GPU リソースは既に解放されているので delete 系を呼ばない
    if (this.contextLost) {
      this.programs.clear();
      this.uniformLocations.clear();
      this.textures = null;
      this.fbos = null;
      this.compositeFbo = null;
      return;
    }

    const gl = this.gl;

    for (const programs of this.programs.values()) {
      for (const program of programs) gl.deleteProgram(program);
    }
    this.programs.clear();
    this.uniformLocations.clear();

    if (this.textures) {
      disposeDepthTextures(gl, this.textures);
      this.textures = null;
    }

    if (this.fbos) {
      for (const fb of this.fbos) {
        gl.deleteFramebuffer(fb.fbo);
        gl.deleteTexture(fb.texture);
      }
      this.fbos = null;
    }

    if (this.compositeFbo) {
      gl.deleteFramebuffer(this.compositeFbo.fbo);
      gl.deleteTexture(this.compositeFbo.texture);
      this.compositeFbo = null;
    }

    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.texCoordBuffer);
    gl.deleteVertexArray(this.quadVAO);
  }

  /** 利用可能なエフェクト一覧を返す（UI 生成用） */
  getAvailableEffects(): readonly EffectDescriptor[] {
    return this.effectDescriptors;
  }

  /**
   * ParticleLayer 等が同一 canvas に重ねるため WebGL2 コンテキストを共有公開する。
   * 同 canvas への 2 回目の getContext('webgl2') が null を返す環境があるため共有を強制。
   */
  getGL(): WebGL2RenderingContext {
    return this.gl;
  }

  /** ParticleLayer が深度オクルージョンに使う深度テクスチャ（未アップロード / context loss 中は null）。 */
  getDepthTexture(): WebGLTexture | null {
    return this.textures ? this.textures.depth : null;
  }
}

function createFramebuffer(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): Framebuffer {
  const texture = gl.createTexture();
  if (!texture) throw new Error('createTexture failed (FBO)');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  if (!fbo) {
    gl.deleteTexture(texture);
    throw new Error('createFramebuffer failed');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    throw new Error(`Framebuffer incomplete: status=0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { fbo, texture, width, height };
}

function bindPassInputs(
  gl: WebGL2RenderingContext,
  pass: PassDescriptor,
  uniforms: Map<string, WebGLUniformLocation>,
  textures: DepthTextureSet,
  fbos: [Framebuffer, Framebuffer] | null,
  lastWrittenFbo: number,
): void {
  for (const input of pass.inputs) {
    if (input === 'image') {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textures.image);
      const loc = uniforms.get('u_image');
      if (loc) gl.uniform1i(loc, 0);
    } else if (input === 'depth') {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textures.depth);
      const loc = uniforms.get('u_depthMap');
      if (loc) gl.uniform1i(loc, 1);
    } else if (input === 'previousPass') {
      if (!fbos || lastWrittenFbo < 0) {
        throw new Error('previousPass を要求するパスの前に FBO 書き込みが必要');
      }
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, fbos[lastWrittenFbo].texture);
      const loc = uniforms.get('u_previousPass');
      if (loc) gl.uniform1i(loc, 2);
    }
  }
}

function setIfPresent(
  uniforms: Map<string, WebGLUniformLocation>,
  name: string,
  setter: (loc: WebGLUniformLocation) => void,
): void {
  const loc = uniforms.get(name);
  if (loc) setter(loc);
}

function writeParamUniform(
  gl: WebGL2RenderingContext,
  loc: WebGLUniformLocation,
  type: 'float' | 'vec2' | 'vec3' | 'bool' | 'enum',
  value: ParamValue,
): void {
  switch (type) {
    case 'float':
    case 'enum':
      gl.uniform1f(loc, value as number);
      return;
    case 'vec2': {
      const v = value as number[];
      gl.uniform2f(loc, v[0], v[1]);
      return;
    }
    case 'vec3': {
      const v = value as number[];
      gl.uniform3f(loc, v[0], v[1], v[2]);
      return;
    }
    case 'bool':
      gl.uniform1i(loc, value ? 1 : 0);
      return;
  }
}
