/**
 * iOS Safari のリロード原因切り分け用の計測モジュール。heartbeat / window エラー /
 * pagehide / visibilitychange を localStorage に記録し DiagnosticsOverlay から参照する。
 * 有効化: URL に ?diag=1 か `localStorage.dp_diag='1'`。本番ロジックには副作用を出さない。
 */

const STORAGE_KEY = 'dp_diag_state_v1';
const FLAG_KEY = 'dp_diag';
const MAX_BOOTS = 8;

type EndKind =
  | 'alive'
  | 'pagehide'
  | 'visibility_hidden'
  | 'window_error'
  | 'unhandled_rejection';

interface BootRecord {
  sessionId: string;
  bootedAt: number;
  lastMainHeartbeatAt: number;
  mainHeartbeatCount: number;
  /** 0 = Worker heartbeat 未受信 */
  lastWorkerHeartbeatAt: number;
  workerHeartbeatCount: number;
  /** alive のまま終わった = 観測されず死亡 = OS kill 疑い */
  endKind: EndKind;
  endAt: number;
  lastError?: { at: number; message: string; source?: string };
  ua: string;
  hasWebGPU: boolean;
}

interface State {
  current: BootRecord;
  history: BootRecord[];
}

let state: State | null = null;
let enabled = false;
let mainTimer: number | null = null;
let listenersAttached = false;
/** UI 更新通知用のリスナー（DiagnosticsOverlay から購読） */
const subscribers = new Set<() => void>();

function isEnabledFromEnv(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('diag') === '1') {
      window.localStorage.setItem(FLAG_KEY, '1');
      return true;
    }
    if (params.get('diag') === '0') {
      window.localStorage.removeItem(FLAG_KEY);
      return false;
    }
    return window.localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function loadHistory(): BootRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { history?: BootRecord[] };
    return Array.isArray(parsed.history) ? parsed.history : [];
  } catch {
    return [];
  }
}

function persist(): void {
  if (!state) return;
  try {
    // current を history と同期保存（次回起動時に前回の生存状況を読む）
    const history = [...state.history];
    const idx = history.findIndex((b) => b.sessionId === state!.current.sessionId);
    if (idx >= 0) {
      history[idx] = state.current;
    } else {
      history.push(state.current);
      if (history.length > MAX_BOOTS) history.shift();
    }
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ history }),
    );
  } catch {
    // localStorage 失敗時は黙って諦める（診断目的なので副作用ゼロを優先）
  }
}

function notify(): void {
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      /* noop */
    }
  }
}

function genSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function markEnd(kind: EndKind): void {
  if (!state) return;
  // alive 以外への遷移はそのまま記録するが、 alive で上書きはしない
  if (state.current.endKind !== 'alive' && kind === 'alive') return;
  state.current.endKind = kind;
  state.current.endAt = Date.now();
  persist();
  notify();
}

function attachListeners(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;

  window.addEventListener('pagehide', () => markEnd('pagehide'));
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markEnd('visibility_hidden');
  });
  window.addEventListener('error', (ev) => {
    if (!state) return;
    state.current.lastError = {
      at: Date.now(),
      message: ev.message || 'window error',
      source: ev.filename,
    };
    markEnd('window_error');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    if (!state) return;
    const reason = ev.reason;
    state.current.lastError = {
      at: Date.now(),
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'unhandled rejection',
    };
    markEnd('unhandled_rejection');
  });
}

export function start(): void {
  if (enabled) return;
  if (!isEnabledFromEnv()) return;
  enabled = true;

  const history = loadHistory();
  const current: BootRecord = {
    sessionId: genSessionId(),
    bootedAt: Date.now(),
    lastMainHeartbeatAt: Date.now(),
    mainHeartbeatCount: 0,
    lastWorkerHeartbeatAt: 0,
    workerHeartbeatCount: 0,
    endKind: 'alive',
    endAt: 0,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    hasWebGPU:
      typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu,
  };
  state = { current, history };
  persist();
  attachListeners();

  // メインスレッドの heartbeat。 React 再レンダーとは独立に走らせる。
  mainTimer = window.setInterval(() => {
    if (!state) return;
    state.current.lastMainHeartbeatAt = Date.now();
    state.current.mainHeartbeatCount += 1;
    persist();
    notify();
  }, 2000);
}

export function markWorkerHeartbeat(at: number, counter: number): void {
  if (!enabled || !state) return;
  state.current.lastWorkerHeartbeatAt = at;
  state.current.workerHeartbeatCount = counter;
  persist();
  notify();
}

export function isEnabled(): boolean {
  return enabled;
}

export function getSnapshot(): State | null {
  if (!state) return null;
  // 履歴に current を含めて返す（オーバーレイ表示用）
  const history = [...state.history];
  const idx = history.findIndex((b) => b.sessionId === state!.current.sessionId);
  if (idx >= 0) history[idx] = state.current;
  else history.push(state.current);
  return { current: state.current, history };
}

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function stop(): void {
  if (mainTimer !== null) {
    window.clearInterval(mainTimer);
    mainTimer = null;
  }
  enabled = false;
}
