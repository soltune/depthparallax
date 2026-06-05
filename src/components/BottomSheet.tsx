import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { SheetState } from '../types';
import { useI18n } from '../i18n/LanguageProvider';

/**
 * モバイル縦用ボトムシート。2 段階スナップ + PointerEvent ベースの drag（OSS 不使用）。
 *
 * 不変条件:
 * - WebGL viewport 更新はスナップ完了時のみ。ドラッグ中は transform: translateY を ref + 直接スタイルで
 *   適用し React state / CSS height に触れない → canvas の clientHeight 不変で ResizeObserver も発火しない。
 *   スナップで data-sheet-state を切替えた瞬間に CSS height/transform が transition し、親 canvas の
 *   padding-bottom 変化で ResizeObserver が一度だけ発火 → reflow。
 * - drag 占有（touch-action: none）は祖先でなく各リーフ（ハンドル / ヘッダ / スライダーのラベル・数値）に付ける。
 *   range スライダー本体は横パンを残すため（touch-action は祖先との積集合で効き、range の祖先に none を
 *   置くと横操作が死ぬ）。Half 本体は pan-y。
 * - orientation 変化で state 保持（制御プロップなので親で持つ）
 *
 * Peek / Half の実 px 高さは CSS（svh / vh）側。スナップ閾値も CSS と整合させ 60px。
 */

const SNAP_THRESHOLD_PX = 60;
/** スナップ完了後の transition 時間（CSS 側と一致させる）。 ms */
const SNAP_TRANSITION_MS = 220;

/** drag 面内でネイティブ操作を優先する子要素（range/ボタン/リンク等）か判定。これで始まった操作では drag/tap を起こさない。 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input[type="range"], button, a, select, textarea') !== null;
}

export interface BottomSheetProps {
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  /** Peek 状態で表示する内容（モード/エフェクト名 + mini slider）。 ハンドルとは別領域 */
  peek: ReactNode;
  /** Half 状態で表示するシート本体（SettingsPane など）。 シート内スクロール許容 */
  children: ReactNode;
}

export function BottomSheet({
  state,
  onStateChange,
  peek,
  children,
}: BottomSheetProps) {
  const { t } = useI18n();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  /** ハンドル + Peek 全体を覆う drag 面（ポインタキャプチャの対象）。 */
  const grabRef = useRef<HTMLDivElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragStartStateRef = useRef<SheetState>('peek');
  /** drag 中の累積 deltaY (px)。 負 = 上方向 = Half 寄り、 正 = 下方向 = Peek 寄り */
  const dragDeltaYRef = useRef(0);
  /** drag 中フラグ。 true の間は transition を一旦切る */
  const isDraggingRef = useRef(false);
  /** pointerdown が interactive 子要素（range/ボタン等）で始まったら true → ネイティブ操作に委譲し drag/tap を起こさない。 */
  const skipGestureRef = useRef(false);

  const applyDragTransform = useCallback((dy: number) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transform = `translateY(${dy}px)`;
  }, []);

  const clearDragTransform = useCallback(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transform = '';
  }, []);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // range スライダー（横操作）・ボタン（タップ）等で始まった操作はネイティブに委譲。
      if (isInteractiveTarget(e.target)) {
        skipGestureRef.current = true;
        return;
      }
      skipGestureRef.current = false;
      const el = grabRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      dragStartYRef.current = e.clientY;
      dragStartStateRef.current = state;
      dragDeltaYRef.current = 0;
      isDraggingRef.current = true;
      const sheet = sheetRef.current;
      if (sheet) {
        // drag 中は transition を切る（追従の遅延を消す）
        sheet.style.transition = 'none';
      }
    },
    [state],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (skipGestureRef.current) return;
      if (!isDraggingRef.current) return;
      const startY = dragStartYRef.current;
      if (startY === null) return;
      const dy = e.clientY - startY;
      // 上方向（Half 寄り）は負、 下方向（Peek 寄り）は正。
      // Half 時は下方向のみ、 Peek 時は上方向のみ動かす（逆方向はゴム効果なしで頭打ち）。
      let clamped = dy;
      if (dragStartStateRef.current === 'peek') {
        clamped = Math.min(0, dy);
      } else {
        clamped = Math.max(0, dy);
      }
      dragDeltaYRef.current = clamped;
      applyDragTransform(clamped);
    },
    [applyDragTransform],
  );

  const finishDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (skipGestureRef.current) return;
      if (!isDraggingRef.current) return;
      const el = grabRef.current;
      if (el && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      isDraggingRef.current = false;
      const sheet = sheetRef.current;
      if (sheet) {
        // transition を戻す（CSS 側のデフォルトに任せる）
        sheet.style.transition = '';
      }
      const delta = dragDeltaYRef.current;
      dragStartYRef.current = null;
      dragDeltaYRef.current = 0;
      const startState = dragStartStateRef.current;
      // スナップ判定: 閾値超えで反対状態へ遷移、 未達なら元へ戻す。
      let nextState: SheetState = startState;
      if (startState === 'peek' && delta <= -SNAP_THRESHOLD_PX) {
        nextState = 'half';
      } else if (startState === 'half' && delta >= SNAP_THRESHOLD_PX) {
        nextState = 'peek';
      }
      // transform を消すと CSS の height + bottom 位置に滑らかに transition で収束する
      clearDragTransform();
      if (nextState !== startState) {
        onStateChange(nextState);
      }
    },
    [clearDragTransform, onStateChange],
  );

  // unmount 時に transition を念のため戻す（StrictMode の二重 mount 等で残らないように）
  useEffect(() => {
    return () => {
      const sheet = sheetRef.current;
      if (sheet) sheet.style.transition = '';
    };
  }, []);

  const handleTogglerClick = useCallback(() => {
    // interactive 子要素（スライダー/ボタン）由来の click は切替対象外。
    if (skipGestureRef.current) {
      skipGestureRef.current = false;
      return;
    }
    // drag せずにタップで切替もできるようにする（アクセシビリティ向上）
    if (isDraggingRef.current) return;
    onStateChange(state === 'peek' ? 'half' : 'peek');
  }, [onStateChange, state]);

  return (
    <div
      ref={sheetRef}
      className="dp-bottom-sheet"
      data-sheet-state={state}
      style={{ '--dp-sheet-transition-ms': `${SNAP_TRANSITION_MS}ms` } as SheetCssVars}
    >
      {/*
        ハンドル + Peek を覆う drag 面。range スライダー・▶■ ボタンは isInteractiveTarget 判定でバイパス。
        キーボード操作は内側 handle(role=button)が担うため、ここには role を付けない（interactive の入れ子回避）。
      */}
      <div
        ref={grabRef}
        className="dp-bottom-sheet__grab"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClick={handleTogglerClick}
      >
        <div
          className="dp-bottom-sheet__handle"
          role="button"
          tabIndex={0}
          aria-label={state === 'peek' ? t.bottomSheet.expand : t.bottomSheet.collapse}
          aria-expanded={state === 'half'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleTogglerClick();
            }
          }}
        >
          <span className="dp-bottom-sheet__handle-bar" aria-hidden="true" />
        </div>
        <div className="dp-bottom-sheet__peek">{peek}</div>
      </div>
      <div className="dp-bottom-sheet__body">{children}</div>
    </div>
  );
}

type SheetCssVars = CSSProperties & {
  '--dp-sheet-transition-ms': string;
};
