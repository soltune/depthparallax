/**
 * useDepthEstimation: Web Worker（depthWorker）越しに深度推定を扱う React フック。
 *
 * - Worker は初回の推論要求で lazy 生成（iOS WebKit のメモリ上限のためアイドル中は居座らせない）
 * - backend 判定: iOS は JSEP WASM バグ回避で常に 'wasm'、他は navigator.gpu があれば 'webgpu'
 * - 推論ごとに requestId を進め、古い結果は破棄。cancelInference は cancel 送出 + 旧結果破棄
 * - モデルロード中の runInference は pending に退避し 'ready' でフラッシュ
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppState,
  DepthResult,
  InferenceBackend,
  ModelLoadProgress,
  WorkerRequest,
  WorkerResponse,
} from '../types';
import { markWorkerHeartbeat } from '../utils/diagnostics';
import { isIOS } from '../utils/platform';

export interface UseDepthEstimationOptions {
  /** 推論結果が返ったときに呼ばれる（最新 requestId と一致するもののみ） */
  onResult?: (result: DepthResult) => void;
  /** エラー時に呼ばれる */
  onError?: (message: string) => void;
}

export interface UseDepthEstimationReturn {
  appState: AppState;
  loadProgress: ModelLoadProgress | null;
  depthResult: DepthResult | null;
  backend: InferenceBackend;
  /** ユーザーがバックエンドを選べる環境か（非 iOS かつ WebGPU 利用可能）。トグル UI の表示判定用 */
  canChooseBackend: boolean;
  /**
   * バックエンドをセッション限定で切替（永続化なし、iOS / WebGPU 非対応では 'wasm' に clamp）。
   * 既存 Worker を破棄し次回 ensureWorker で再生成（呼び出し側で現在画像の再推論が必要）。
   */
  setBackend: (backend: InferenceBackend) => void;
  error: string | null;
  /** モデルを事前ロードする（ユーザー操作前の warm-up 用、任意）。通常は runInference が暗黙に呼ぶ */
  initModel: () => void;
  /** モデルロード失敗時の再試行。worker に load を再送する */
  retryLoad: () => void;
  /** エラーバナーを閉じる（state は変えずに error のみクリア） */
  dismissError: () => void;
  runInference: (
    imageData: ImageData,
    sourceWidth: number,
    sourceHeight: number,
  ) => void;
  cancelInference: () => void;
}

interface PendingInfer {
  imageData: ImageData;
  sourceWidth: number;
  sourceHeight: number;
  requestId: number;
}

/** この環境で WebGPU が利用可能か（navigator.gpu の有無）。 */
function webgpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
}

/**
 * ユーザーがバックエンドを選べる環境か（非 iOS かつ WebGPU 利用可）。
 * WebGPU の数値が壊れる端末向けの手動回避トグルを出すか判定する。
 */
export function canChooseBackend(): boolean {
  return !isIOS() && webgpuAvailable();
}

/**
 * URL の `?backend=wasm|webgpu` をセッション限定のシードとして読む（localStorage 不使用）。
 * 不正値・未指定は null。リロード後も URL に残るため選択が保たれ、リンク共有もできる。
 */
function readBackendOverride(): InferenceBackend | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('backend');
  if (value === 'wasm' || value === 'webgpu') return value;
  return null;
}

function detectBackend(): InferenceBackend {
  // iOS では JSEP (WebGPU/WebNN) の WASM が WebKit のメモリ/JIT バグを誘発する
  // ため、 navigator.gpu の有無・URL override に関わらず WASM バックエンドを強制する
  // (onnxruntime#26827, transformers.js#1242)。
  if (isIOS()) return 'wasm';
  // URL の ?backend= を優先（特定 GPU で WebGPU の数値が壊れる端末向けの手動回避）。
  // webgpu 指定でも navigator.gpu が無ければ実行不能なので wasm にフォールバック。
  const override = readBackendOverride();
  if (override) {
    return override === 'webgpu' && !webgpuAvailable() ? 'wasm' : override;
  }
  // Worker からも navigator.gpu は見えるが、UI スレッド側で先に判定して Worker に伝える
  if (webgpuAvailable()) {
    return 'webgpu';
  }
  return 'wasm';
}

export function useDepthEstimation(
  options?: UseDepthEstimationOptions,
): UseDepthEstimationReturn {
  const { onResult, onError } = options ?? {};

  // コールバックは ref 経由で参照し、Worker 初期化を再実行しないようにする
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef<number>(0);
  /** モデルロードが完了したか（worker 側 'ready' 進捗を受信した） */
  const modelLoadedRef = useRef<boolean>(false);
  /** モデルロード完了前に到着した推論要求の待避先 */
  const pendingInferRef = useRef<PendingInfer | null>(null);

  const [appState, setAppState] = useState<AppState>('idle');
  const [loadProgress, setLoadProgress] = useState<ModelLoadProgress | null>(null);
  const [depthResult, setDepthResult] = useState<DepthResult | null>(null);
  const [backend, setBackendState] = useState<InferenceBackend>(() => detectBackend());
  // backend の最新値を同期参照（setBackend で Worker 破棄判定を同期的に行うため）
  const backendRef = useRef<InferenceBackend>(backend);
  const [choosable] = useState<boolean>(() => canChooseBackend());
  const [error, setError] = useState<string | null>(null);

  /**
   * Worker が無ければ生成して 'load' を送る。既にあればそのまま返す。
   * iOS Safari でのアイドル時メモリ占有を避けるため、最初の利用時まで Worker 生成を遅延させる。
   */
  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker(
      new URL('../workers/depthWorker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    modelLoadedRef.current = false;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'heartbeat': {
          markWorkerHeartbeat(msg.payload.at, msg.payload.counter);
          return;
        }
        case 'progress': {
          setLoadProgress(msg.payload);
          if (msg.payload.status === 'ready') {
            modelLoadedRef.current = true;
            // 保留中の推論があればここでフラッシュ
            const pending = pendingInferRef.current;
            if (pending) {
              pendingInferRef.current = null;
              setAppState('inferring');
              const req: WorkerRequest = { type: 'infer', payload: pending };
              workerRef.current?.postMessage(req);
            } else {
              setAppState((prev) =>
                prev === 'model_loading' || prev === 'idle' ? 'ready' : prev,
              );
            }
          }
          break;
        }
        case 'result': {
          // 古い結果は破棄
          if (msg.payload.requestId !== requestIdRef.current) {
            return;
          }
          const result: DepthResult = {
            depthMap: msg.payload.depthMap,
            rawDisparity: msg.payload.rawDisparity,
            width: msg.payload.width,
            height: msg.payload.height,
            sourceWidth: msg.payload.sourceWidth,
            sourceHeight: msg.payload.sourceHeight,
            backend: msg.payload.backend,
            inferenceTimeMs: msg.payload.inferenceTimeMs,
          };
          setDepthResult(result);
          setAppState('displaying');
          onResultRef.current?.(result);
          // iOS WebKit のメモリ上限対策: 推論完了で Worker を即 terminate し transformers.js /
          // ORT / モデル重みを解放（次画像は ensureWorker が再生成、モデルは HTTP キャッシュ）。
          if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
            modelLoadedRef.current = false;
            pendingInferRef.current = null;
          }
          break;
        }
        case 'error': {
          // requestId 付きエラーは旧リクエスト分なら無視
          if (
            typeof msg.payload.requestId === 'number' &&
            msg.payload.requestId !== requestIdRef.current
          ) {
            return;
          }
          // モデルロード失敗時は保留中の推論も諦める
          if (!modelLoadedRef.current) {
            pendingInferRef.current = null;
          }
          setError(msg.payload.message);
          setAppState((prev) => {
            // 推論エラーは ready に戻して再試行可能にする
            if (prev === 'inferring') return 'ready';
            // モデルロードエラーは idle に戻し、retryLoad で再試行する想定
            if (prev === 'model_loading') return 'idle';
            return prev;
          });
          onErrorRef.current?.(msg.payload.message);
          break;
        }
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      const message = event.message || 'Worker でエラーが発生しました';
      setError(message);
      onErrorRef.current?.(message);
    };

    setAppState('model_loading');
    setError(null);
    setLoadProgress(null);
    const loadReq: WorkerRequest = { type: 'load', payload: { backend } };
    worker.postMessage(loadReq);

    return worker;
  }, [backend]);

  // unmount 時のみ Worker を破棄。mount で生成はしない（lazy）。
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      modelLoadedRef.current = false;
      pendingInferRef.current = null;
    };
  }, []);

  // 明示的に Worker を立ち上げモデルロードを開始する warm-up 用 API（通常は runInference が暗黙に行う）。
  const initModel = useCallback(() => {
    ensureWorker();
  }, [ensureWorker]);

  const runInference = useCallback(
    (imageData: ImageData, sourceWidth: number, sourceHeight: number) => {
      const worker = ensureWorker();

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setError(null);

      if (modelLoadedRef.current) {
        setAppState('inferring');
        const req: WorkerRequest = {
          type: 'infer',
          payload: { imageData, sourceWidth, sourceHeight, requestId },
        };
        worker.postMessage(req);
      } else {
        // モデルロード中: 'ready' 進捗到着時にフラッシュする
        pendingInferRef.current = {
          imageData,
          sourceWidth,
          sourceHeight,
          requestId,
        };
        // appState は 'model_loading' のまま（ensureWorker が設定済み）
      }
    },
    [ensureWorker],
  );

  const cancelInference = useCallback(() => {
    pendingInferRef.current = null;
    if (!workerRef.current) return;
    // requestId を進め、遅れて届く進行中の結果を捨てられるようにする
    requestIdRef.current += 1;
    const req: WorkerRequest = { type: 'cancel' };
    workerRef.current.postMessage(req);
    setAppState((prev) => (prev === 'inferring' ? 'ready' : prev));
  }, []);

  const retryLoad = useCallback(() => {
    const worker = ensureWorker();
    // 既存ワーカーでロード失敗した場合の再送パス（handleLoad は loadingPromise を await するだけで冪等）。
    setError(null);
    setLoadProgress(null);
    setAppState('model_loading');
    modelLoadedRef.current = false;
    const req: WorkerRequest = { type: 'load', payload: { backend } };
    worker.postMessage(req);
  }, [backend, ensureWorker]);

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  const setBackend = useCallback((next: InferenceBackend) => {
    const clamped = isIOS() || !webgpuAvailable() ? 'wasm' : next;
    if (backendRef.current === clamped) return;
    backendRef.current = clamped;
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    modelLoadedRef.current = false;
    pendingInferRef.current = null;
    setBackendState(clamped);
  }, []);

  return {
    appState,
    loadProgress,
    depthResult,
    backend,
    canChooseBackend: choosable,
    setBackend,
    error,
    initModel,
    retryLoad,
    dismissError,
    runInference,
    cancelInference,
  };
}
