/// <reference lib="webworker" />
/**
 * 深度推定 Web Worker。load/infer/cancel を受け、transformers.js v3 の depth-estimation を実行する。
 *
 * CLAUDE.md の不変条件に従う:
 * - シングルスレッド WASM 固定（numThreads=1, COOP/COEP 不要化）
 * - モデル自己ホスト（allowRemoteModels=false, localModelPath = BASE_URL + 'models/'）
 * - disparity → depth 反転と正規化は depthUtils.normalize() に集約
 * - 推論結果は requestId で競合制御し、cancel 後 / 古い結果は postMessage をスキップ
 */

import { pipeline, env, RawImage } from '@huggingface/transformers';
import type { DepthEstimationPipeline, ProgressInfo } from '@huggingface/transformers';
import type {
  InferenceBackend,
  ModelLoadProgress,
  WorkerRequest,
  WorkerResponse,
} from '../types';
import { normalize } from '../utils/depthUtils';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// 自己ホストモデルの環境設定。Worker には document が無いため BASE_URL は Vite が
// import.meta.env に注入する値を使う（vite.config.ts の base に追従）。
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = `${import.meta.env.BASE_URL}models/`;
env.useBrowserCache = true;
// SharedArrayBuffer を避けるためシングルスレッド固定（COOP/COEP 不要化）
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

/**
 * 非 JSEP 版 (ort-wasm-simd-threaded.wasm/.mjs) を強制ロードする設定。
 *
 * JSEP 版 (.jsep.wasm, 21MB) は iOS Safari (WebKit 26) で推論後もメモリが解放されず WebContent が
 * kill される重大バグがある (onnxruntime#26827, transformers.js#1242)。非 JSEP 版 (11MB) は同問題が
 * 無く、wasmPaths 上書きが公式 workaround。ただし wasmPaths.wasm は JSEP/非 JSEP どちらでも上書き
 * されるため WebGPU(=JSEP) 経路で設定すると壊れる → backend === 'wasm' のときだけ設定する。
 */
function configureNonJsepWasmPaths(): void {
  if (!env.backends.onnx.wasm) return;
  const ortBase = `${import.meta.env.BASE_URL}ort/`;
  // .mjs は scripts/copy-ort-wasm.mjs で .js にリネーム済み（中身同じ）。素の Apache/Nginx は .mjs を
  // application/octet-stream で返し Safari の ES module MIME 検査に弾かれるため .js を指す。
  env.backends.onnx.wasm.wasmPaths = {
    wasm: `${ortBase}ort-wasm-simd-threaded.wasm`,
    mjs: `${ortBase}ort-wasm-simd-threaded.js`,
  };
}

const MODEL_ID = 'depth-anything-v2-small';

// 診断用 heartbeat（DiagnosticsOverlay 用の生存信号）。
let heartbeatCounter = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
function startHeartbeat(): void {
  if (heartbeatTimer !== null) return;
  heartbeatTimer = setInterval(() => {
    heartbeatCounter += 1;
    post({
      type: 'heartbeat',
      payload: { counter: heartbeatCounter, at: Date.now() },
    });
  }, 2000);
}

/** ロード済みのパイプライン（再利用） */
let depthPipeline: DepthEstimationPipeline | null = null;
/** ロード中の Promise（重複ロード防止） */
let loadingPromise: Promise<DepthEstimationPipeline> | null = null;
/** 使用中バックエンド */
let currentBackend: InferenceBackend = 'wasm';
/** cancel フラグ：true の間に到着した推論結果は postMessage しない */
let cancelled = false;
/** 直近に受信した推論リクエストID。これより古い ID の結果は破棄 */
let latestRequestId = -1;

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    ctx.postMessage(message, transfer);
  } else {
    ctx.postMessage(message);
  }
}

/**
 * transformers.js の progress イベントを UI 表示用の ModelLoadProgress に正規化する。
 * file 単位のイベントのため、進捗値はファイル単位の概算となる。
 */
function toLoadProgress(info: ProgressInfo): ModelLoadProgress | null {
  switch (info.status) {
    case 'initiate':
      return {
        status: 'loading',
        progress: 0,
        message: `モデル準備中: ${info.file}`,
      };
    case 'download':
      return {
        status: 'downloading',
        progress: 0,
        message: `${info.file} をダウンロード中`,
      };
    case 'progress':
      // info.progress は 0〜100
      return {
        status: 'downloading',
        progress: Math.max(0, Math.min(1, info.progress / 100)),
        message: `${info.file} をダウンロード中`,
      };
    case 'done':
      return {
        status: 'loading',
        progress: 1,
        message: `${info.file} を読み込み`,
      };
    case 'ready':
      return {
        status: 'ready',
        progress: 1,
        message: 'モデル準備完了',
      };
    default:
      return null;
  }
}

async function handleLoad(backend: InferenceBackend): Promise<void> {
  currentBackend = backend;

  if (depthPipeline) {
    post({
      type: 'progress',
      payload: { status: 'ready', progress: 1, message: 'モデル準備完了（キャッシュ）' },
    });
    return;
  }

  // WASM 経路のみ非 JSEP 版を強制（WebGPU=JSEP 経路で wasmPaths.wasm を上書きすると壊れる）。
  if (backend === 'wasm') {
    configureNonJsepWasmPaths();
  }

  if (!loadingPromise) {
    loadingPromise = (async () => {
      // q4f16 単一バリアントで両 backend に対応する
      const p = await pipeline('depth-estimation', MODEL_ID, {
        device: backend,
        dtype: 'q4f16',
        progress_callback: (info: ProgressInfo) => {
          const progress = toLoadProgress(info);
          if (progress) {
            post({ type: 'progress', payload: progress });
          }
        },
      });
      return p as unknown as DepthEstimationPipeline;
    })();
  }

  try {
    depthPipeline = await loadingPromise;
    // progress_callback の 'ready' が発火しないケースもあるため、フォールバックで明示通知
    post({
      type: 'progress',
      payload: { status: 'ready', progress: 1, message: 'モデル準備完了' },
    });
  } catch (err) {
    loadingPromise = null;
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', payload: { message: `モデルロード失敗: ${message}` } });
  }
}

async function handleInfer(payload: {
  imageData: ImageData;
  sourceWidth: number;
  sourceHeight: number;
  requestId: number;
}): Promise<void> {
  const { imageData, sourceWidth, sourceHeight, requestId } = payload;

  latestRequestId = requestId;
  cancelled = false;

  if (!depthPipeline) {
    post({
      type: 'error',
      payload: { message: 'モデル未ロードのまま推論が要求されました', requestId },
    });
    return;
  }

  try {
    // ImageData (RGBA) → RawImage 3ch（pipeline 側で normalize される）
    // pipeline 内部リサイズは入力既に 518×518 なので実質 no-op
    const rgba = new RawImage(imageData.data, imageData.width, imageData.height, 4);
    const rgb = rgba.rgb();

    const startedAt = performance.now();
    const output = await depthPipeline(rgb);
    const inferenceTimeMs = performance.now() - startedAt;

    // cancel または古いリクエストの結果は破棄
    if (cancelled || requestId !== latestRequestId) {
      return;
    }

    const result = Array.isArray(output) ? output[0] : output;
    const tensor = result.predicted_depth;
    const rawData = tensor.data;
    if (!(rawData instanceof Float32Array)) {
      post({
        type: 'error',
        payload: {
          message: `予期しない depth テンソルの型: ${rawData.constructor.name}`,
          requestId,
        },
      });
      return;
    }

    // 出力 dims は [H, W] または [1, H, W] / [1, 1, H, W] のいずれも有り得る
    const dims = tensor.dims;
    const height = dims[dims.length - 2];
    const width = dims[dims.length - 1];
    if (!height || !width || height * width !== rawData.length) {
      post({
        type: 'error',
        payload: {
          message: `depth テンソルの shape 不整合: dims=${JSON.stringify(dims)} length=${rawData.length}`,
          requestId,
        },
      });
      return;
    }

    // 「0=手前, 1=奥」に正規化（disparity→depth方向反転 + min-max 正規化）
    const depthMap = normalize(rawData);

    // raw も main thread に渡す（CDF 切替時に再正規化する原本として保持）。
    // rawData はテンソルの内部バッファを指している可能性があるので、コピーしてから transfer する。
    const rawDisparity = new Float32Array(rawData);

    post(
      {
        type: 'result',
        payload: {
          depthMap,
          rawDisparity,
          width,
          height,
          sourceWidth,
          sourceHeight,
          backend: currentBackend,
          inferenceTimeMs,
          requestId,
        },
      },
      [depthMap.buffer, rawDisparity.buffer],
    );
  } catch (err) {
    if (cancelled) return;
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', payload: { message: `推論失敗: ${message}`, requestId } });
  }
}

function handleCancel(): void {
  // onnxruntime-web は途中キャンセル不可なので、結果到着後の postMessage をスキップするフラグを立てる
  cancelled = true;
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const data = event.data;
  switch (data.type) {
    case 'load':
      void handleLoad(data.payload.backend);
      break;
    case 'infer':
      void handleInfer(data.payload);
      break;
    case 'cancel':
      handleCancel();
      break;
  }
};

// 診断 heartbeat は常時起動（プロダクションコストは postMessage 1 回 / 2s で無視できる）。
// メインスレッド側で diag が無効ならこのメッセージは捨てられる。
startHeartbeat();
