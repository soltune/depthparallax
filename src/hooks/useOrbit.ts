/**
 * 3D メッシュ・オービット用の入力フック。
 *
 * - ドラッグ（PointerEvent 1 本指 / マウス）: yaw / pitch をドラッグ差分で蓄積
 * - マルチタッチ pinch（PointerEvent 2 本指）: 2 本指距離差を distance に反映
 * - ホイール: distance をズーム
 * - ダブルクリック: 姿勢を初期値にリセット
 * - ジャイロ ON 時: 「ON した瞬間からの相対姿勢変化」を yaw/pitch に反映
 *   （絶対姿勢は使わない。横持ち時のねじれを回避）
 * - `useParallax` と同時に使うことは想定しない（親側で currentEffect 分岐）
 *
 * 戻り値は毎フレーム再レンダーを避けるため `getOrbit()` getter とし、消費側の rAF から読む。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrbitState } from '../types';
import { clamp } from '../utils/math';
import { requestDeviceOrientationPermission } from '../utils/deviceOrientation';
import { detectMobile } from '../utils/platform';

// OrbitState は types/ を正本とし、本モジュールからも re-export する。
export type { OrbitState };

export interface UseOrbitConfig {
  sensitivity: number;
  autoRotate: boolean;
  useGyro: boolean;
}

export interface UseOrbitReturn {
  getOrbit: () => OrbitState;
  /** 姿勢を初期値にリセットする。  distance を省略すると {@link DEFAULT_DISTANCE} を使う。 */
  resetOrbit: (distance?: number) => void;
  hasGyro: boolean;
  requestGyroPermission: () => Promise<boolean>;
}

const DEFAULT_DISTANCE = 2.5;
const INITIAL_ORBIT: OrbitState = { yaw: 0, pitch: 0, distance: DEFAULT_DISTANCE };
const DRAG_SENSITIVITY_BASE = 0.005; // rad/px
const WHEEL_SENSITIVITY = 0.0015; // distance change / wheel px
const PINCH_SENSITIVITY = 0.005; // distance change / pinch delta px
const MIN_DISTANCE = 1.0;
const MAX_DISTANCE = 5.0;
const PITCH_LIMIT = Math.PI / 2 - 0.05; // ジンバルロック回避
/** 自動回転速度（rad/s）。dt ベースで書き高リフレッシュレート対応 */
const AUTO_ROTATE_SPEED = 0.3;

export function useOrbit(
  containerRef: React.RefObject<HTMLElement | null>,
  config: UseOrbitConfig,
): UseOrbitReturn {
  const configRef = useRef<UseOrbitConfig>(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const orbitRef = useRef<OrbitState>({ ...INITIAL_ORBIT });

  // デスクトップ Chrome/Firefox は DeviceOrientationEvent を生やすがセンサーが
  // 無くイベントが発火しない（=押せるのに動かない死んだトグル）。 モバイル限定にする。
  const [hasGyro] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      'DeviceOrientationEvent' in window &&
      detectMobile(),
  );

  // 自動回転の rAF ループ
  useEffect(() => {
    let rafId = 0;
    let cancelled = false;
    let lastTime = performance.now();
    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      if (configRef.current.autoRotate) {
        orbitRef.current.yaw += AUTO_ROTATE_SPEED * dt;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  // PointerEvent（ドラッグ + マルチタッチ pinch）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 各 pointer の最新位置を保持。 2 個揃ったら pinch、 1 個なら通常ドラッグ。
    const pointers = new Map<number, { x: number; y: number }>();
    // pinch 中の前フレーム距離（distance 反映用）
    let lastPinchDistance: number | null = null;

    const pinchDistance = (): number | null => {
      if (pointers.size < 2) return null;
      const pts = Array.from(pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      return Math.hypot(dx, dy);
    };

    const handlePointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // capture 取得に失敗しても致命的ではないので握りつぶす
      }
      if (pointers.size === 2) {
        lastPinchDistance = pinchDistance();
      } else {
        lastPinchDistance = null;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const nx = e.clientX;
      const ny = e.clientY;
      const dx = nx - prev.x;
      const dy = ny - prev.y;
      pointers.set(e.pointerId, { x: nx, y: ny });

      if (configRef.current.useGyro) {
        // ジャイロ ON 中はポインタ入力でカメラを動かさない
        return;
      }

      if (pointers.size >= 2) {
        // pinch: 距離変化を distance に反映（縮める = ズームイン）
        const cur = pinchDistance();
        if (cur !== null && lastPinchDistance !== null) {
          const dDist = cur - lastPinchDistance;
          orbitRef.current.distance = clamp(
            orbitRef.current.distance - dDist * PINCH_SENSITIVITY,
            MIN_DISTANCE,
            MAX_DISTANCE,
          );
        }
        lastPinchDistance = cur;
      } else {
        // 通常ドラッグ: yaw / pitch
        const sensitivity =
          DRAG_SENSITIVITY_BASE * Math.max(0.01, configRef.current.sensitivity);
        orbitRef.current.yaw += dx * sensitivity;
        orbitRef.current.pitch = clamp(
          orbitRef.current.pitch + dy * sensitivity,
          -PITCH_LIMIT,
          PITCH_LIMIT,
        );
      }
    };

    const handlePointerEnd = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        // 既に解放済みなら無視
      }
      // 2 → 1 に減ったタイミングで pinch 状態をクリアして通常ドラッグに戻す
      lastPinchDistance = pointers.size >= 2 ? pinchDistance() : null;
    };

    const handleDoubleClick = () => {
      orbitRef.current = { ...INITIAL_ORBIT };
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbitRef.current.distance = clamp(
        orbitRef.current.distance + e.deltaY * WHEEL_SENSITIVITY,
        MIN_DISTANCE,
        MAX_DISTANCE,
      );
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerEnd);
    container.addEventListener('pointercancel', handlePointerEnd);
    container.addEventListener('pointerleave', handlePointerEnd);
    container.addEventListener('dblclick', handleDoubleClick);
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerEnd);
      container.removeEventListener('pointercancel', handlePointerEnd);
      container.removeEventListener('pointerleave', handlePointerEnd);
      container.removeEventListener('dblclick', handleDoubleClick);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [containerRef]);

  // DeviceOrientationEvent: ON した瞬間からの相対変化を yaw / pitch に反映
  useEffect(() => {
    if (!hasGyro) return;
    if (!config.useGyro) return;

    // 「ジャイロ ON 時の orientation」を基準姿勢として記録し、 そこからの差分のみ反映
    let baseGamma: number | null = null;
    let baseBeta: number | null = null;
    let baseYaw = orbitRef.current.yaw;
    let basePitch = orbitRef.current.pitch;

    const GAMMA_TO_YAW = (Math.PI / 180) * 1.5; // gamma 1° = yaw 1.5° 相当
    const BETA_TO_PITCH = (Math.PI / 180) * 1.5;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (!configRef.current.useGyro) return;
      const gamma = e.gamma ?? 0;
      const beta = e.beta ?? 0;
      if (baseGamma === null || baseBeta === null) {
        baseGamma = gamma;
        baseBeta = beta;
        baseYaw = orbitRef.current.yaw;
        basePitch = orbitRef.current.pitch;
        return;
      }
      const dGamma = gamma - baseGamma;
      const dBeta = beta - baseBeta;
      orbitRef.current.yaw = baseYaw + dGamma * GAMMA_TO_YAW;
      orbitRef.current.pitch = clamp(
        basePitch + dBeta * BETA_TO_PITCH,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      );
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, [hasGyro, config.useGyro]);

  const requestGyroPermission = useCallback(
    () => requestDeviceOrientationPermission(),
    [],
  );

  const resetOrbit = useCallback((distance?: number) => {
    orbitRef.current = {
      yaw: 0,
      pitch: 0,
      distance: clamp(distance ?? DEFAULT_DISTANCE, MIN_DISTANCE, MAX_DISTANCE),
    };
  }, []);

  const getOrbit = useCallback((): OrbitState => {
    const o = orbitRef.current;
    return { yaw: o.yaw, pitch: o.pitch, distance: o.distance };
  }, []);

  return { getOrbit, resetOrbit, hasGyro, requestGyroPermission };
}
