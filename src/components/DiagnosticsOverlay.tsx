import { useEffect, useState } from 'react';
import { getSnapshot, isEnabled, subscribe } from '../utils/diagnostics';

/**
 * 診断オーバーレイ。右下にセッション情報と直近ブート履歴を表示する（diag 無効時は何もレンダーしない）。
 * 有効化: ?diag=1 を 1 度開く（以降 localStorage に永続）。無効化: ?diag=0。
 */
export function DiagnosticsOverlay() {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isEnabled()) return;
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  if (!isEnabled()) return null;
  const snap = getSnapshot();
  if (!snap) return null;

  const now = Date.now();
  const cur = snap.current;
  const elapsed = ((now - cur.bootedAt) / 1000).toFixed(1);
  const mainLag = ((now - cur.lastMainHeartbeatAt) / 1000).toFixed(1);
  const workerLag =
    cur.lastWorkerHeartbeatAt === 0
      ? '—'
      : ((now - cur.lastWorkerHeartbeatAt) / 1000).toFixed(1);

  // 履歴は新しいものが下になるように boot 時刻昇順 → 表示は最新が上
  const history = [...snap.history].sort((a, b) => b.bootedAt - a.bootedAt);

  return (
    <div
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 9999,
        maxWidth: 'min(92vw, 420px)',
        padding: '8px 10px',
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 11,
        lineHeight: 1.45,
        background: 'rgba(0, 0, 0, 0.78)',
        color: '#d8f0ff',
        border: '1px solid rgba(120, 200, 255, 0.35)',
        borderRadius: 6,
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      <div style={{ fontWeight: 600, color: '#9be3ff' }}>
        diag · {cur.sessionId}
      </div>
      <div>
        elapsed: {elapsed}s · main lag: {mainLag}s · worker lag: {workerLag}s
      </div>
      <div>
        main hb: {cur.mainHeartbeatCount} · worker hb: {cur.workerHeartbeatCount}
        {' · '}gpu: {cur.hasWebGPU ? 'yes' : 'no'}
      </div>
      {cur.lastError && (
        <div style={{ color: '#ffb0b0' }}>
          err: {cur.lastError.message.slice(0, 80)}
        </div>
      )}
      <div
        style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px dashed rgba(255,255,255,0.18)',
        }}
      >
        <div style={{ opacity: 0.7 }}>
          recent boots (newest first, alive=未観測終了≒OS kill):
        </div>
        {history.slice(0, 6).map((b) => {
          const aliveSec = ((b.endAt > 0 ? b.endAt : now) - b.bootedAt) / 1000;
          const lastMainSec = (b.lastMainHeartbeatAt - b.bootedAt) / 1000;
          const lastWorkerSec =
            b.lastWorkerHeartbeatAt === 0
              ? -1
              : (b.lastWorkerHeartbeatAt - b.bootedAt) / 1000;
          const isCurrent = b.sessionId === cur.sessionId;
          return (
            <div
              key={b.sessionId}
              style={{ color: isCurrent ? '#d8f0ff' : '#9aa6b2' }}
            >
              {isCurrent ? '▶ ' : '· '}
              {b.sessionId.slice(0, 14)} life {aliveSec.toFixed(1)}s · end{' '}
              {b.endKind} · main@{lastMainSec.toFixed(1)} · worker@
              {lastWorkerSec < 0 ? '—' : lastWorkerSec.toFixed(1)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
