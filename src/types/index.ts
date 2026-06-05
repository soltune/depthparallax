export type InferenceBackend = 'webgpu' | 'wasm';

export type AppState =
  | 'idle'
  | 'model_loading'
  | 'ready'
  | 'inferring'
  | 'displaying';

export interface ModelLoadProgress {
  /** 'downloading' = ネットワークDL中, 'loading' = キャッシュ読み出し/パース中, 'ready' = 完了 */
  status: 'downloading' | 'loading' | 'ready';
  /** 0.0〜1.0 */
  progress: number;
  message: string;
}

export interface DepthResult {
  /** 正規化済み深度マップ (0.0=手前, 1.0=奥) Float32Array, [height x width] */
  depthMap: Float32Array;
  /** 推論の生出力 disparity（正規化前、大きい値=近い）。深度コントラスト強調の切替で再正規化するため保持。 */
  rawDisparity: Float32Array;
  /** 深度マップの解像度（パディング込みの正方サイズ） */
  width: number;
  height: number;
  /** 元画像の解像度（深度マップの有効領域算出に使用） */
  sourceWidth: number;
  sourceHeight: number;
  backend: InferenceBackend;
  inferenceTimeMs: number;
}

/** 視差パラメータ。デフォルト値は `src/viewModes/parallax.ts` の `DEFAULT_PARALLAX_CONFIG` を参照。 */
export interface ParallaxConfig {
  /** 最大変位ピクセル数 */
  maxDisplacement: number;
  /** スムージング係数 0.0〜1.0 */
  smoothing: number;
  useGyro: boolean;
  /** 視差方向の反転（false: 入力方向に画像が追従 / true: 入力と逆 = 3D 視差感） */
  invertDirection: boolean;
  /** エッジアーティファクト緩和用ズーム係数 */
  edgeZoom: number;
}

/** エフェクト識別子（'orbit' は ViewMode 側で扱うため含まない）。 */
export type EffectType =
  | 'parallax'
  | 'fog'
  | 'neon'
  | 'scanline'
  | 'chromatic'
  | 'anaglyph'
  | 'dof'
  | 'tiltshift'
  | 'dolly'
  | 'particles';

/** 操作モード。視差ビュー / 3D ビューの最上位軸。 */
export type ViewMode = 'parallax' | 'orbit';

/**
 * 3D ビューのカメラ姿勢。useOrbit（producer）と SceneRenderer（consumer）で共有する。
 * gl/ は hooks/ を import できないため中立な types/ に置く。
 */
export interface OrbitState {
  yaw: number;
  pitch: number;
  distance: number;
}

/** 視差ビュー内のエフェクト分類（EffectPanel を 2 グループ表示するキー）。filter=静的フィルタ / motion=動き系。 */
export type EffectGroup = 'filter' | 'motion';

/** モバイル縦のボトムシート状態。 */
export type SheetState = 'peek' | 'half';

/** エフェクトパラメータのスキーマ（UI スライダー自動生成にも使う） */
export interface EffectParamSchema {
  /** パラメータ名（uniform 名から `u_` を除いた形） */
  name: string;
  label: string;
  /** 値の型。'enum' は離散選択肢（uniform へは float と同じ uniform1f、UI はセグメントボタン）で options 必須。 */
  type: 'float' | 'vec2' | 'vec3' | 'bool' | 'enum';
  min?: number;
  max?: number;
  default: number | number[] | boolean;
  step?: number;
  /** type === 'enum' の選択肢。value は uniform に渡す数値 */
  options?: ReadonlyArray<{ value: number; label: string }>;
  /** true で中点を中立とする双極スライダー表示（中央ティック + スナップ + 方向ラベル、float 専用）。 */
  bipolar?: boolean;
  /** bipolar 時の負側 / 正側ラベル（例 { negative: '広角', positive: '望遠' }）。未指定なら符号のみ。 */
  bipolarLabels?: { negative: string; positive: string };
}

/** 描画パスの定義（1パスエフェクトは passes 長 = 1、2パスは 2、DoF 等は 3） */
export interface PassDescriptor {
  vertexShader: 'fullscreen';
  fragmentShader: string;
  /**
   * 出力先。'fbo'=中間 FBO（ピンポン）/ 'screen'=default framebuffer /
   * 'compositeFbo'=合成レイヤー用 3 枚目（Descriptor に書かずとも setCompositeMode(true) で
   * 最終パスの 'screen' が実行時に振り替わる）。
   */
  output: 'fbo' | 'screen' | 'compositeFbo';
  /** 入力テクスチャ。'image'=TEXTURE0 / 'depth'=TEXTURE1 / 'previousPass'=前パス出力 FBO(TEXTURE2)。 */
  inputs: Array<'image' | 'depth' | 'previousPass'>;
}

export interface EffectDescriptor {
  type: EffectType;
  displayName: string;
  /** 描画パスの定義（順に実行） */
  passes: PassDescriptor[];
  /** エフェクト固有のパラメータスキーマ（UI 自動生成用） */
  params: EffectParamSchema[];
  /** UI グループ（視覚フィルター行 / 動きを加える行）。 */
  group: EffectGroup;
  /** Peek 状態のミニスライダーに出す代表パラメータ名。未定義なら（parallax 等）モード名のみ表示。 */
  primaryParam?: string;
}

/** Worker→Mainへのメッセージ */
export type WorkerResponse =
  | { type: 'progress'; payload: ModelLoadProgress }
  | { type: 'result'; payload: DepthResult & { requestId: number } }
  | { type: 'error'; payload: { message: string; requestId?: number } }
  | { type: 'heartbeat'; payload: { counter: number; at: number } };

/** Main→Workerへのメッセージ */
export type WorkerRequest =
  | { type: 'load'; payload: { backend: InferenceBackend } }
  | {
      type: 'infer';
      payload: {
        imageData: ImageData;
        sourceWidth: number;
        sourceHeight: number;
        requestId: number;
      };
    }
  | { type: 'cancel' };
