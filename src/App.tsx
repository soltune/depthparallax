import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prepareImageForInference, shrinkIfTooLarge } from './utils/imageUtils';
import { normalizeCdfGamma } from './utils/depthUtils';
import { sampleCenterDepth, sampleCenterDepthBlock } from './utils/depthSampler';
import { useDepthEstimation } from './hooks/useDepthEstimation';
import { Dropzone, type SampleItem } from './components/Dropzone';
import { ProgressBar, selectPhase } from './components/ProgressBar';
import { ViewerDispatch } from './components/ViewerDispatch';
import { SettingsPane } from './components/SettingsPane';
import { DepthMapPiP } from './components/DepthMapPiP';
import { DepthMapModal } from './components/DepthMapModal';
import { BottomSheet } from './components/BottomSheet';
import { MiniPrimarySlider } from './components/MiniPrimarySlider';
import { FpsCounter } from './components/FpsCounter';
import { DiagnosticsOverlay } from './components/DiagnosticsOverlay';
import { LanguageSelect } from './components/LanguageSelect';
import { BackendSelect } from './components/BackendSelect';
import { useI18n } from './i18n/LanguageProvider';
import { localizeEffects } from './i18n/localizeEffects';
import { isWideLayout, useViewportLayout } from './hooks/useViewportLayout';
import { detectMobile } from './utils/platform';
import { EFFECT_DESCRIPTORS } from './gl/effects';
import { ORBIT_PARAM_SCHEMA } from './viewModes/orbit';
import { DEFAULT_PARALLAX_CONFIG } from './viewModes/parallax';
import {
  type DepthResult,
  type EffectDescriptor,
  type EffectType,
  type InferenceBackend,
  type ParallaxConfig,
  type SheetState,
  type ViewMode,
} from './types';

type ParamValue = number | number[] | boolean;
type ParamMap = Record<string, ParamValue>;
type EffectParamsMap = Record<EffectType, ParamMap>;

function initializeDefaultParams(
  descriptors: readonly EffectDescriptor[],
): EffectParamsMap {
  const out = {} as EffectParamsMap;
  for (const desc of descriptors) {
    const params: ParamMap = {};
    for (const p of desc.params) {
      params[p.name] = p.default;
    }
    out[desc.type] = params;
  }
  return out;
}

function initializeOrbitParams(): ParamMap {
  const out: ParamMap = {};
  for (const p of ORBIT_PARAM_SCHEMA) {
    out[p.name] = p.default;
  }
  return out;
}

/**
 * モバイル時に重い既定値を抑える descriptor フォーク（現状 particles のみ: default 300→150 / max 600→300）。
 * 元の EFFECT_DESCRIPTORS はシェーダーコンパイル経路でも使うため不変に保ち、UI 用だけをフォークする。
 */
function applyMobileFallbacks(
  descriptors: readonly EffectDescriptor[],
  isMobile: boolean,
): readonly EffectDescriptor[] {
  if (!isMobile) return descriptors;
  return descriptors.map((d) => {
    if (d.type !== 'particles') return d;
    return {
      ...d,
      params: d.params.map((p) =>
        p.name === 'particleCount' ? { ...p, default: 150, max: 300 } : p,
      ),
    };
  });
}

/** サンプル画像の定義。label は locale から解決するため key で保持する。 */
const SAMPLE_DEFS = [
  { key: 'outdoor', path: 'samples/sample-01.jpg', thumbnail: 'samples/thumb-01.jpg' },
  { key: 'portrait', path: 'samples/sample-02.jpg', thumbnail: 'samples/thumb-02.jpg' },
  { key: 'city', path: 'samples/sample-03.jpg', thumbnail: 'samples/thumb-03.jpg' },
] as const;

/** Dolly Zoom 自動再生 1 サイクルの基準時間 (ms)。実効は DOLLY_DURATION_MS / dollySpeed（speed=1.0 で 2.4 秒）。 */
const DOLLY_DURATION_MS = 2400;
/** Dolly Zoom 自動再生のピーク強度 */
const DOLLY_PEAK = 0.6;
/** 自動再生中に disable する dolly のパラメータ名 */
const DOLLY_PLAYING_DISABLED_PARAMS: ReadonlySet<string> = new Set(['dollyAmount']);

/**
 * 「深度コントラスト強調」ON 時の固定チューニング値（A/B + スライダー評価で確定）。normalizeCdfGamma へ渡す。
 * - ENHANCE_NEAR_GAMMA: near factor (1-depth) の累乗指数（手前を展開し背景を奥へアンカー）
 * - ENHANCE_CDF_MIX:    線形 ↔ CDF のブレンド率（0=線形, 1=CDF。見栄え差の主成分）
 */
const ENHANCE_NEAR_GAMMA = 1.4;
const ENHANCE_CDF_MIX = 0.75;

/**
 * フィルター系の焦点深度 UI（FocalDepthControl）の対象。dof / tiltshift は focalAuto / focalDepth を
 * 共有スキーマで持つので、表示中が tiltshift ならそちら、他は dof に寄せる。
 */
function filterFocalTarget(effect: EffectType): 'dof' | 'tiltshift' {
  return effect === 'tiltshift' ? 'tiltshift' : 'dof';
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

function App() {
  const { t, format } = useI18n();
  const objectUrlRef = useRef<string | null>(null);
  const requestGyroPermissionRef = useRef<(() => Promise<boolean>) | null>(null);
  /**
   * 再選択時、推論完了まで古い canvas を残すための「次の imageData」保留枠。onResult で lastImageData を
   * 置換し、古い depthResult + 新 imageData の不整合期間を作らない（初回 null なら即 set）。
   */
  const pendingImageDataRef = useRef<ImageData | null>(null);
  /** 直近の推論入力（前処理済み 518 ペイロード）。backend 切替時の同一画像再推論用。未選択時は null。 */
  const lastInferRef = useRef<{
    imageData: ImageData;
    sourceWidth: number;
    sourceHeight: number;
  } | null>(null);

  const [lastResult, setLastResult] = useState<DepthResult | null>(null);
  const [lastImageSrc, setLastImageSrc] = useState<string | null>(null);
  const [lastImageData, setLastImageData] = useState<ImageData | null>(null);
  // 現在画像のサムネ（dataURL）。サンプルは SAMPLE_DEFS[].thumbnail、ファイルは loadImage 後に生成。
  // サンプル画像は数 MB あり fetch + decode に数秒かかる。無反応に見えないよう loadImage 前後で立てる。
  const [imageLoading, setImageLoading] = useState(false);
  const [parallaxConfig, setParallaxConfig] = useState<ParallaxConfig>(DEFAULT_PARALLAX_CONFIG);
  // depth トグル ON で canvas 右下に DepthMapPiP。PiP タップでモーダル open。OFF で PiP もモーダルも消える。
  const [showDepthPreview, setShowDepthPreview] = useState(false);
  const [pipModalOpen, setPipModalOpen] = useState(false);
  // 深度コントラスト強調（CDF）への切替（既定 ON）。バイモーダル分布でクラスタ内の凹凸を均等展開する。
  const [enhanceDepth, setEnhanceDepth] = useState(true);
  const [hasGyroSupport, setHasGyroSupport] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('parallax');
  const [currentEffect, setCurrentEffect] = useState<EffectType>('parallax');
  // エフェクト別パラメータ（切替えても各エフェクトの設定を保持）。useMemo より前に評価するため detectMobile() を直接見る。
  const [effectParamsMap, setEffectParamsMap] = useState<EffectParamsMap>(() =>
    initializeDefaultParams(applyMobileFallbacks(EFFECT_DESCRIPTORS, detectMobile())),
  );
  const currentParams = effectParamsMap[currentEffect];
  // 3D ビュー用パラメータ（depthScale / autoRotate）。ViewMode 切替で保持される。
  const [orbitParams, setOrbitParams] = useState<ParamMap>(() =>
    initializeOrbitParams(),
  );
  // モバイル縦ボトムシートの開閉状態。mobile-portrait から外れても破棄せず、戻った時に同じ state で再描画する。
  const [sheetState, setSheetState] = useState<SheetState>('peek');

  // viewer / 深度マップ PiP に渡す DepthResult。enhanceDepth ON なら raw disparity から CDF 再正規化した
  // depthMap に差し替える。lastResult（線形正規化の原本）は不変に保ち、画像切替の副作用 useEffect が
  // トグル時に誤発火するのを防ぐ。
  const displayedResult = useMemo<DepthResult | null>(() => {
    if (!lastResult) return null;
    if (!enhanceDepth) return lastResult;
    return {
      ...lastResult,
      depthMap: normalizeCdfGamma(
        lastResult.rawDisparity,
        ENHANCE_NEAR_GAMMA,
        ENHANCE_CDF_MIX,
      ),
    };
  }, [lastResult, enhanceDepth]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  const handleToggleEnhanceDepth = useCallback(() => {
    setEnhanceDepth((v) => !v);
  }, []);

  const handleOpenDepthModal = useCallback(() => {
    setPipModalOpen(true);
  }, []);

  const handleCloseDepthModal = useCallback(() => {
    setPipModalOpen(false);
  }, []);

  // depth トグル OFF でモーダルも閉じる（PiP が消えるのにモーダルだけ残る不整合を防ぐ）。
  useEffect(() => {
    if (!showDepthPreview && pipModalOpen) {
      setPipModalOpen(false);
    }
  }, [showDepthPreview, pipModalOpen]);

  const handleOrbitParamsChange = useCallback((newParams: ParamMap) => {
    setOrbitParams((prev) => ({ ...prev, ...newParams }));
  }, []);

  // Dolly Zoom 自動再生の状態。ここから effectParamsMap.dolly.dollyAmount を書く際は paramsSyncToken も
  // bump して EffectPanel の localParams をリセットさせる（通常スライダー入力以外では再同期しないため）。
  const [isDollyPlaying, setIsDollyPlaying] = useState(false);
  const [dollyProgress, setDollyProgress] = useState(0);
  const [paramsSyncToken, setParamsSyncToken] = useState(0);
  const dollyStartTimeRef = useRef(0);
  // rAF 内の stale closure 回避用に speed を ref 参照。反映は次サイクル開始時（cycle 途中の伸縮はジャンプして見える）。
  const dollyPlaybackParamsRef = useRef<{ speed: number }>({ speed: 1.0 });

  const bumpParamsSyncToken = useCallback(() => {
    setParamsSyncToken((t) => t + 1);
  }, []);

  const handleEffectChange = useCallback((type: EffectType) => {
    setCurrentEffect(type);
  }, []);

  // ParamMap は number|number[]|boolean の union なので、FocalDepthControl の number/boolean プロップ用に型を解く。
  const dollyFocalAutoValue =
    typeof effectParamsMap.dolly?.dollyFocalAuto === 'boolean'
      ? effectParamsMap.dolly.dollyFocalAuto
      : true;
  const dollyFocalDepthValue =
    typeof effectParamsMap.dolly?.dollyFocalDepth === 'number'
      ? effectParamsMap.dolly.dollyFocalDepth
      : 0.5;

  // dof / tiltshift の焦点深度自動化（パラメータ名は両者共通）。表示中のエフェクトから値を引き、
  // 非 dof/tiltshift 時は dof にフォールバック（FocalDepthControl 非表示なので値は未使用）。
  const filterFocalEffect = filterFocalTarget(currentEffect);
  const filterFocalAutoValue =
    typeof effectParamsMap[filterFocalEffect]?.focalAuto === 'boolean'
      ? (effectParamsMap[filterFocalEffect].focalAuto as boolean)
      : true;
  const filterFocalDepthValue =
    typeof effectParamsMap[filterFocalEffect]?.focalDepth === 'number'
      ? (effectParamsMap[filterFocalEffect].focalDepth as number)
      : 0.5;

  const handleParamsChange = useCallback(
    (newParams: ParamMap) => {
      setEffectParamsMap((prev) => ({
        ...prev,
        [currentEffect]: { ...prev[currentEffect], ...newParams },
      }));
    },
    [currentEffect],
  );

  // 自動再生中も最新 speed を rAF から参照できるよう ref 同期（反映は次サイクル開始時）。
  useEffect(() => {
    const speed = effectParamsMap.dolly?.dollySpeed;
    dollyPlaybackParamsRef.current = {
      speed: typeof speed === 'number' && speed > 0 ? speed : 1.0,
    };
  }, [effectParamsMap.dolly]);

  // Dolly 自動再生 rAF: 0 → ピーク → 0 を smoothstep で往復し、サイクル境界で継ぎ足しループ。
  // 停止は handleDollyStop（dollyAmount=0 込み）のみ。cycle 長は開始時に dollySpeed をキャプチャ（変更は次サイクルから）。
  useEffect(() => {
    if (!isDollyPlaying) return;
    let cycleDuration = DOLLY_DURATION_MS / dollyPlaybackParamsRef.current.speed;
    dollyStartTimeRef.current = performance.now();
    let rafId = 0;
    const tick = () => {
      const t = (performance.now() - dollyStartTimeRef.current) / cycleDuration;
      if (t >= 1.0) {
        // 次サイクル開始: dollySpeed の最新値で cycleDuration を更新。
        dollyStartTimeRef.current = performance.now();
        cycleDuration = DOLLY_DURATION_MS / dollyPlaybackParamsRef.current.speed;
        setDollyProgress(0);
        rafId = requestAnimationFrame(tick);
        return;
      }
      setDollyProgress(t);
      // 0 → ピーク → 0 を smoothstep で往復
      const phase = t < 0.5 ? 2 * t : 2 * (1 - t);
      const eased = phase * phase * (3 - 2 * phase);
      setEffectParamsMap((prev) => ({
        ...prev,
        dolly: { ...prev.dolly, dollyAmount: eased * DOLLY_PEAK },
      }));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isDollyPlaying]);

  const handleDollyPlay = useCallback(() => {
    setDollyProgress(0);
    setIsDollyPlaying(true);
  }, []);

  const handleDollyStop = useCallback(() => {
    setIsDollyPlaying(false);
    setDollyProgress(0);
    setEffectParamsMap((prev) => ({
      ...prev,
      dolly: { ...prev.dolly, dollyAmount: 0 },
    }));
    bumpParamsSyncToken();
  }, [bumpParamsSyncToken]);

  // 「自動」ボタン押下（auto=true で呼ばれる）: 画像中央 depth を即推定して dollyFocalDepth をリセット。
  // EffectPanel の localParams 再同期のため syncToken を bump。
  const handleDollyFocalAutoChange = useCallback(
    (auto: boolean) => {
      setEffectParamsMap((prev) => {
        const nextDolly: ParamMap = { ...prev.dolly, dollyFocalAuto: auto };
        if (auto && displayedResult) {
          const centerDepth = sampleCenterDepth(displayedResult);
          if (centerDepth !== null) {
            nextDolly.dollyFocalDepth = centerDepth;
          }
        }
        return { ...prev, dolly: nextDolly };
      });
      bumpParamsSyncToken();
    },
    [displayedResult, bumpParamsSyncToken],
  );

  // スライダーを手で動かしたら自動追従を解除（dollyFocalAuto=false）。以後、画像切替時の自動セット対象から外れる。
  const handleDollyFocalDepthChange = useCallback((depth: number) => {
    setEffectParamsMap((prev) => ({
      ...prev,
      dolly: { ...prev.dolly, dollyFocalDepth: depth, dollyFocalAuto: false },
    }));
  }, []);

  // dof / tiltshift の「自動」ボタン押下（dolly と同挙動）。currentEffect が dof/tiltshift の
  // 前提で表示中の方にだけ書き込む（FocalDepthControl の出現条件）。
  const handleFilterFocalAutoChange = useCallback(
    (auto: boolean) => {
      const target = filterFocalTarget(currentEffect);
      setEffectParamsMap((prev) => {
        const next: ParamMap = { ...prev[target], focalAuto: auto };
        if (auto && displayedResult) {
          const sampled = sampleCenterDepthBlock(displayedResult);
          if (sampled !== null) next.focalDepth = sampled;
        }
        return { ...prev, [target]: next };
      });
      bumpParamsSyncToken();
    },
    [currentEffect, displayedResult, bumpParamsSyncToken],
  );

  // スライダーを手で動かしたら自動追従を解除（focalAuto=false）。以後、画像切替時の自動セット対象から外れる。
  const handleFilterFocalDepthChange = useCallback(
    (depth: number) => {
      const target = filterFocalTarget(currentEffect);
      setEffectParamsMap((prev) => ({
        ...prev,
        [target]: { ...prev[target], focalDepth: depth, focalAuto: false },
      }));
    },
    [currentEffect],
  );

  // 画像切替時（lastResult 更新）: 自動再生を停止（古い rAF が新画像に書き続けるのを防ぐ）し、
  // focalAuto が true のエフェクトは焦点深度を中央 depth に自動セット（dolly は中央 1px、dof/tiltshift は NxN）。
  useEffect(() => {
    if (!lastResult) return;
    setIsDollyPlaying(false);
    setDollyProgress(0);
    const filterSample = sampleCenterDepthBlock(lastResult);
    setEffectParamsMap((prev) => {
      const next = { ...prev };

      const prevDolly = prev.dolly;
      const nextDolly: ParamMap = { ...prevDolly, dollyAmount: 0 };
      if (prevDolly?.dollyFocalAuto) {
        const centerDepth = sampleCenterDepth(lastResult);
        if (centerDepth !== null) {
          nextDolly.dollyFocalDepth = centerDepth;
        }
      }
      next.dolly = nextDolly;

      for (const key of ['dof', 'tiltshift'] as const) {
        const prevFilter = prev[key];
        if (prevFilter?.focalAuto && filterSample !== null) {
          next[key] = { ...prevFilter, focalDepth: filterSample };
        }
      }

      return next;
    });
    bumpParamsSyncToken();
  }, [lastResult, bumpParamsSyncToken]);

  // dolly 以外 or 3D ビューへ切替えた瞬間、自動再生を停止し dollyAmount を 0 にリセット。
  useEffect(() => {
    if (viewMode === 'parallax' && currentEffect === 'dolly') return;
    setIsDollyPlaying(false);
    setDollyProgress(0);
    setEffectParamsMap((prev) =>
      prev.dolly?.dollyAmount === 0
        ? prev
        : { ...prev, dolly: { ...prev.dolly, dollyAmount: 0 } },
    );
  }, [currentEffect, viewMode]);

  // dolly 選択 + 画像ロード済みで自動プレビュー再生（画像差替でも fire）。常時ループ（停止は handleDollyStop のみ）。
  // 直前に image-change effect が dollyAmount=0 リセットを走らせるので、ここで再生開始しても 0 起点になる。
  useEffect(() => {
    if (viewMode !== 'parallax') return;
    if (currentEffect !== 'dolly') return;
    if (!lastResult) return;
    setDollyProgress(0);
    setIsDollyPlaying(true);
  }, [currentEffect, viewMode, lastResult]);

  const isMobile = useMemo(() => detectMobile(), []);
  // モバイル向けに particles を絞った descriptor を UI に渡す（EffectRenderer は元の descriptor のまま）。
  const uiEffects = useMemo(
    () => localizeEffects(applyMobileFallbacks(EFFECT_DESCRIPTORS, isMobile), t),
    [isMobile, t],
  );
  // 表示ラベルを現在言語で解決したサンプル一覧（path/thumbnail は固定）。
  const samples = useMemo<SampleItem[]>(
    () => SAMPLE_DEFS.map((d) => ({ ...d, label: t.samples[d.key] })),
    [t],
  );
  // PC / モバイル横は wide（左 canvas / 右ペイン）、モバイル縦は sheet（BottomSheet）。
  const layout = useViewportLayout();
  const wide = isWideLayout(layout);
  const isSheetLayout = !wide;

  const {
    appState,
    loadProgress,
    backend,
    canChooseBackend,
    setBackend,
    error,
    initModel,
    retryLoad,
    dismissError,
    runInference,
    cancelInference,
  } = useDepthEstimation({
    onResult: (r) => {
      // 再選択中は setLastImageData を保留しているので、ここで imageData と depthResult を atomic に確定する。
      if (pendingImageDataRef.current) {
        setLastImageData(pendingImageDataRef.current);
        pendingImageDataRef.current = null;
      }
      setLastResult(r);
    },
  });

  // 画像選択 → 表示までの体感待ちを減らすためモデルを事前ロード。iOS の OOM kill は非 JSEP WASM 強制で
  // 根治済みで、アイドル常駐は ~30MB と WebContent 上限に余裕がある。
  useEffect(() => {
    initModel();
  }, [initModel]);

  // runInference の最新参照（backend 切替 effect から stale な closure を呼ばないため）。
  const runInferenceRef = useRef(runInference);
  useEffect(() => {
    runInferenceRef.current = runInference;
  }, [runInference]);

  // backend 切替時に現在画像を新 backend で自動再推論（初回 mount は no-op）。Worker はフック側で破棄済みなので
  // runInference → ensureWorker が新 backend で再生成する。
  const didInitBackendRef = useRef(false);
  useEffect(() => {
    if (!didInitBackendRef.current) {
      didInitBackendRef.current = true;
      return;
    }
    const last = lastInferRef.current;
    if (!last) return;
    runInferenceRef.current(last.imageData, last.sourceWidth, last.sourceHeight);
  }, [backend]);

  // ヘッダーから WebGPU ⇄ WASM をセッション限定で切替（特定 GPU で WebGPU の深度が壊れる端末向けの手動回避）。
  // ?backend= も replaceState で同期しリロード耐性と共有リンクを両立（ストレージには書かない）。
  const handleBackendChange = useCallback(
    (next: InferenceBackend) => {
      setBackend(next);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('backend', next);
        window.history.replaceState(null, '', url);
      } catch {
        /* URL 同期失敗は無視（切替自体はメモリ上で成立済み） */
      }
    },
    [setBackend],
  );

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const startInference = useCallback(
    async (image: HTMLImageElement, previewUrl: string) => {
      try {
        if (appState === 'inferring') {
          cancelInference();
        }
        const shrunk = shrinkIfTooLarge(image, 4096);
        const prepared = prepareImageForInference(shrunk, 518);
        // バックエンド切替時に同じ画像を再推論できるよう、前処理済み入力を保持。
        lastInferRef.current = {
          imageData: prepared.imageData,
          sourceWidth: prepared.sourceWidth,
          sourceHeight: prepared.sourceHeight,
        };
        setLastImageSrc(previewUrl);
        // viewer 表示中の再選択は古い canvas を残し、結果到着時に pendingImageDataRef → setLastImageData で
        // 置換する。初回（lastImageData なし）は即 set して showInferringPanel 経路に乗せる。
        if (lastImageData) {
          pendingImageDataRef.current = prepared.imageData;
        } else {
          pendingImageDataRef.current = null;
          setLastResult(null);
          setLastImageData(prepared.imageData);
        }
        runInference(prepared.imageData, prepared.sourceWidth, prepared.sourceHeight);
      } catch (e) {
        console.error('[App] preprocess failed', e);
      }
    },
    [appState, cancelInference, lastImageData, runInference],
  );

  const handleSelectFile = useCallback(
    async (file: File) => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setImageLoading(true);
      try {
        const img = await loadImage(url);
        await startInference(img, url);
      } catch (e) {
        console.error('[App] failed to load file', e);
      } finally {
        setImageLoading(false);
      }
    },
    [startInference],
  );

  const handleSelectSample = useCallback(
    async (samplePath: string) => {
      setImageLoading(true);
      try {
        const url = `${import.meta.env.BASE_URL}${samplePath}`;
        const img = await loadImage(url);
        await startInference(img, url);
      } catch (e) {
        console.error('[App] failed to load sample', e);
      } finally {
        setImageLoading(false);
      }
    },
    [startInference],
  );

  const handleConfigChange = useCallback((patch: Partial<ParallaxConfig>) => {
    setParallaxConfig((c) => ({ ...c, ...patch }));
  }, []);

  const handleToggleGyro = useCallback(async () => {
    if (!parallaxConfig.useGyro) {
      const requester = requestGyroPermissionRef.current;
      const granted = requester ? await requester() : false;
      if (granted) {
        setParallaxConfig((c) => ({ ...c, useGyro: true }));
      } else {
        console.warn('[App] gyro permission denied');
      }
    } else {
      setParallaxConfig((c) => ({ ...c, useGyro: false }));
    }
  }, [parallaxConfig.useGyro]);

  // 'idle' = Worker 未生成（lazy 待ち）なので Dropzone は有効。無効化はロード中/推論中/画像 fetch+decode 中のみ。
  const dropzoneDisabled =
    appState === 'model_loading' || appState === 'inferring' || imageLoading;
  // 全画面 Dropzone は初回（lastImageData なし）だけ。以後の差替は ImagePicker から（画面遷移なし）。
  // 初回選択直後の loadImage 中は隠して dp-inferring パネルに統一する。
  const showDropzone = !lastImageData && !imageLoading;
  // 初回選択時の推論中（viewer 未表示）はサムネ + キャンセル UI を出す。viewer 表示中の再選択は
  // showInferOverlay 経路に乗る。imageLoading 中は lastImageSrc 未取得なのでサムネ無し（JSX 側でガード）。
  const showInferringPanel =
    !lastResult &&
    (imageLoading ||
      appState === 'inferring' ||
      (appState === 'model_loading' && lastImageData !== null));
  const showViewer = lastResult !== null && lastImageData !== null;
  // viewer 表示中の再推論時は canvas 上に中央オーバーレイを重ねる。
  const showInferOverlay =
    showViewer && (imageLoading || appState === 'inferring' || appState === 'model_loading');
  // 進捗ラベル/バーの正準ソース（上部 ProgressBar・dp-inferring・dp-canvas-overlay で共用）。
  const phase = selectPhase(appState, loadProgress);
  // 上部 ProgressBar は中央オーバーレイ/パネルが出ていない時のみ。lazy-load 経路では model_loading/inferring は
  // 常に lastImageData を伴うため、実質「両パネルが出ない端ケース」用フォールバック。
  const showTopProgress = phase !== null && !showInferOverlay && !showInferringPanel;

  // SettingsPane は wide / sheet 両レイアウトで同一 props。要素を 1 度だけ生成し両分岐で使い回す（mutually exclusive）。
  const settingsPane = (
    <SettingsPane
      viewMode={viewMode}
      onViewModeChange={handleViewModeChange}
      effects={uiEffects}
      currentEffect={currentEffect}
      onEffectChange={handleEffectChange}
      currentParams={currentParams}
      onParamsChange={handleParamsChange}
      disabledParams={
        currentEffect === 'dolly' && isDollyPlaying
          ? DOLLY_PLAYING_DISABLED_PARAMS
          : undefined
      }
      syncToken={paramsSyncToken}
      parallaxConfig={parallaxConfig}
      onConfigChange={handleConfigChange}
      hasGyro={hasGyroSupport}
      onToggleGyro={handleToggleGyro}
      showDepthPreview={showDepthPreview}
      onToggleDepthPreview={() => setShowDepthPreview((v) => !v)}
      enhanceDepth={enhanceDepth}
      onToggleEnhanceDepth={handleToggleEnhanceDepth}
      samples={samples}
      onSelectFile={handleSelectFile}
      onSelectSample={handleSelectSample}
      imagePickerDisabled={dropzoneDisabled}
      enableCameraCapture={isMobile}
      orbitParams={orbitParams}
      onOrbitParamsChange={handleOrbitParamsChange}
      isDollyPlaying={isDollyPlaying}
      dollyProgress={dollyProgress}
      onDollyPlay={handleDollyPlay}
      onDollyStop={handleDollyStop}
      dollyFocalAuto={dollyFocalAutoValue}
      dollyFocalDepth={dollyFocalDepthValue}
      onDollyFocalAutoChange={handleDollyFocalAutoChange}
      onDollyFocalDepthChange={handleDollyFocalDepthChange}
      filterFocalAuto={filterFocalAutoValue}
      filterFocalDepth={filterFocalDepthValue}
      onFilterFocalAutoChange={handleFilterFocalAutoChange}
      onFilterFocalDepthChange={handleFilterFocalDepthChange}
    />
  );

  return (
    <main className="dp-main">
      <header className="dp-header">
        <h1>Depth Parallax Demo</h1>
        <div className="dp-badges">
          {canChooseBackend ? (
            <BackendSelect backend={backend} onChange={handleBackendChange} />
          ) : (
            <span className={`dp-badge ${backend === 'webgpu' ? 'dp-badge--gpu' : 'dp-badge--cpu'}`}>
              {t.app.backend}: {backend === 'webgpu' ? 'WebGPU' : 'WASM'}
            </span>
          )}
          <LanguageSelect />
          <a
            className="dp-github-link"
            href="https://github.com/soltune/depthparallax"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.app.github}
            title={t.app.github}
          >
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
              />
            </svg>
          </a>
        </div>
      </header>

      {error && (
        <div className="dp-error" role="alert">
          <span className="dp-error__message">
            {t.app.errorPrefix}: {error}
          </span>
          <span className="dp-error__actions">
            {appState === 'idle' && (
              <button type="button" onClick={retryLoad}>
                {t.app.reload}
              </button>
            )}
            <button
              type="button"
              onClick={dismissError}
              aria-label={t.app.dismissError}
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {showTopProgress && (
        <ProgressBar appState={appState} loadProgress={loadProgress} />
      )}

      <section className="dp-section">
        {showDropzone && (
          <Dropzone
            samples={samples}
            onSelectFile={handleSelectFile}
            onSelectSample={handleSelectSample}
            disabled={dropzoneDisabled}
            enableCameraCapture={isMobile}
          />
        )}

        {showInferringPanel && (
          <div className="dp-inferring">
            {lastImageSrc && (
              <img src={lastImageSrc} alt={t.app.inputPreview} className="dp-thumbnail" />
            )}
            <div className="dp-inferring__detail">
              <p style={{ margin: 0 }}>
                {imageLoading
                  ? t.app.loadingImage
                  : phase
                    ? t.progress[phase.key]
                    : t.app.processing}
              </p>
              {phase && !imageLoading && (
                <div className="dp-inferring__bar">
                  <div
                    className={
                      phase.indeterminate
                        ? 'dp-inferring__bar-fill dp-inferring__bar-fill--indeterminate'
                        : 'dp-inferring__bar-fill'
                    }
                    style={
                      phase.indeterminate
                        ? undefined
                        : { width: `${Math.max(0, Math.min(1, phase.progress)) * 100}%` }
                    }
                  />
                </div>
              )}
              {!imageLoading && (
                <button type="button" onClick={cancelInference}>
                  {t.app.cancel}
                </button>
              )}
            </div>
          </div>
        )}

        {showViewer && displayedResult && lastImageData && (
          <div
            className={`dp-viewer ${wide ? 'dp-viewer--wide' : 'dp-viewer--sheet'}`}
            data-sheet-state={isSheetLayout ? sheetState : undefined}
          >
            <div className="dp-viewer__canvas">
              <ViewerDispatch
                imageData={lastImageData}
                depthResult={displayedResult}
                // 3D ビューはジャイロ強制 OFF（操作中の意図しない揺れ回避）。視差ビュー復帰時は parallaxConfig.useGyro を保持。
                config={
                  viewMode === 'orbit'
                    ? { ...parallaxConfig, useGyro: false }
                    : parallaxConfig
                }
                viewMode={viewMode}
                currentEffect={currentEffect}
                currentParams={currentParams}
                orbitParams={orbitParams}
                onGyroSupport={setHasGyroSupport}
                requestGyroPermissionRef={requestGyroPermissionRef}
              />
              {showDepthPreview && (
                <DepthMapPiP
                  depthResult={displayedResult}
                  onOpen={handleOpenDepthModal}
                />
              )}
              {showInferOverlay && (
                <div className="dp-canvas-overlay" role="status" aria-live="polite">
                  <div className="dp-canvas-overlay__panel">
                    <div className="dp-canvas-overlay__label">
                      {imageLoading
                        ? t.app.loadingImage
                        : (phase ? t.progress[phase.key] : t.app.analyzingDepth)}
                    </div>
                    <div className="dp-canvas-overlay__bar">
                      <div
                        className={
                          !phase || phase.indeterminate || imageLoading
                            ? 'dp-canvas-overlay__bar-fill dp-canvas-overlay__bar-fill--indeterminate'
                            : 'dp-canvas-overlay__bar-fill'
                        }
                        style={
                          !phase || phase.indeterminate || imageLoading
                            ? undefined
                            : { width: `${Math.max(0, Math.min(1, phase.progress)) * 100}%` }
                        }
                      />
                    </div>
                    {!imageLoading && (
                      <button
                        type="button"
                        className="dp-canvas-overlay__cancel"
                        onClick={cancelInference}
                      >
                        {t.app.cancel}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {import.meta.env.DEV && <FpsCounter />}
            </div>
            {isSheetLayout ? (
              <BottomSheet
                state={sheetState}
                onStateChange={setSheetState}
                peek={
                  <MiniPrimarySlider
                    viewMode={viewMode}
                    currentEffect={currentEffect}
                    effects={uiEffects}
                    currentParams={currentParams}
                    onParamsChange={handleParamsChange}
                    orbitParams={orbitParams}
                    onOrbitParamsChange={handleOrbitParamsChange}
                    disabledParams={
                      currentEffect === 'dolly' && isDollyPlaying
                        ? DOLLY_PLAYING_DISABLED_PARAMS
                        : undefined
                    }
                    syncToken={paramsSyncToken}
                    isDollyPlaying={isDollyPlaying}
                    onDollyPlay={handleDollyPlay}
                    onDollyStop={handleDollyStop}
                  />
                }
              >
                {settingsPane}
              </BottomSheet>
            ) : (
              settingsPane
            )}
          </div>
        )}
      </section>

      {showDepthPreview && pipModalOpen && displayedResult && (
        <DepthMapModal depthResult={displayedResult} onClose={handleCloseDepthModal} />
      )}

      <footer className="dp-footer">
        <span>{t.app.footerModel}</span>
        {lastResult && (
          <span>
            {format(t.app.inferenceTime, {
              ms: lastResult.inferenceTimeMs.toFixed(0),
              w: lastResult.width,
              h: lastResult.height,
            })}
          </span>
        )}
      </footer>
      <DiagnosticsOverlay />
    </main>
  );
}

export default App;
