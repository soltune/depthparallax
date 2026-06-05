/**
 * useParallax: ポインタ / ジャイロ入力を補間済み変位に変換するフック。
 *
 * - 入力統一: PointerEvent（pointermove）でマウス・タッチ・ペンを処理（mousemove は不使用）
 * - ジャイロ: DeviceOrientationEvent。config.useGyro=true でポインタを無視しジャイロ優先
 * - スムージング: rAF ループで current += (target - current) * smoothing の指数移動平均
 * - 方向反転: getOffset() で config.invertDirection を適用。シェーダ慣習と入力の向きが軸ごとに
 *   食い違うため X/Y を非対称に符号調整する（詳細は getOffset）
 * - iOS 13+ の許可: requestGyroPermission() をユーザータップから呼ぶ
 *
 * 戻り値は再レンダー回避のため getOffset() getter（消費側の rAF から読む）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParallaxConfig } from '../types';
import { clamp } from '../utils/math';
import { requestDeviceOrientationPermission } from '../utils/deviceOrientation';
import { detectMobile } from '../utils/platform';

export interface UseParallaxReturn {
  /** 最新の補間済み変位 [-1, 1] を返す（毎フレーム呼ぶ）。invertDirection 適用済み */
  getOffset: () => [number, number];
  /** ジャイロが扱えそうなデバイスか（DeviceOrientationEvent の存在で簡易判定） */
  hasGyro: boolean;
  /** iOS 13+ 等のジャイロ許可リクエスト（ユーザー操作イベントのハンドラから呼ぶ）。
   *  許可不要なデバイスでは true を返す。 */
  requestGyroPermission: () => Promise<boolean>;
}

export function useParallax(
  containerRef: React.RefObject<HTMLElement | null>,
  config: ParallaxConfig,
): UseParallaxReturn {
  // config は ref 経由で参照し、変更のたびにイベントを貼り直さないようにする
  const configRef = useRef<ParallaxConfig>(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const targetRef = useRef<[number, number]>([0, 0]);
  const currentRef = useRef<[number, number]>([0, 0]);

  // デスクトップ Chrome/Firefox は DeviceOrientationEvent を生やすがセンサーが
  // 無くイベントが発火しない（=押せるのに動かない死んだトグル）。 モバイル限定にする。
  const [hasGyro] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      'DeviceOrientationEvent' in window &&
      detectMobile(),
  );

  // スムージング rAF: target → current を毎フレーム指数移動平均で寄せる
  useEffect(() => {
    let rafId = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const smoothing = clamp(configRef.current.smoothing, 0, 1);
      const [tx, ty] = targetRef.current;
      const [cx, cy] = currentRef.current;
      currentRef.current = [cx + (tx - cx) * smoothing, cy + (ty - cy) * smoothing];
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  // PointerEvent ハンドラ（マウス・タッチ・ペン統一）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePointerMove = (e: PointerEvent) => {
      // ジャイロ優先モードではポインタを無視
      if (configRef.current.useGyro) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // コンテナ中心からの相対位置を [-1, 1] に正規化
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      targetRef.current = [clamp(nx, -1, 1), clamp(ny, -1, 1)];
    };

    const handlePointerLeave = () => {
      if (configRef.current.useGyro) return;
      // コンテナから出たらニュートラルに戻す
      targetRef.current = [0, 0];
    };

    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerleave', handlePointerLeave);
    container.addEventListener('pointercancel', handlePointerLeave);

    return () => {
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
      container.removeEventListener('pointercancel', handlePointerLeave);
    };
  }, [containerRef]);

  // DeviceOrientationEvent ハンドラ
  useEffect(() => {
    if (!hasGyro) return;
    if (!config.useGyro) return;

    // gamma: 左右傾き (-90〜90°), beta: 前後傾き (-180〜180°)
    // ±30° で最大変位とする。beta はスマホを多少前傾で持つのが自然なので -30° をニュートラル基準。
    const TILT_RANGE = 30;
    const BETA_NEUTRAL = 30;
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (!configRef.current.useGyro) return;
      const gamma = e.gamma ?? 0;
      const beta = e.beta ?? 0;
      const nx = clamp(gamma / TILT_RANGE, -1, 1);
      const ny = clamp((beta - BETA_NEUTRAL) / TILT_RANGE, -1, 1);
      targetRef.current = [nx, ny];
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      // useGyro を切ったあとはポインタ入力で上書きされるので target はそのまま放置でOK
    };
  }, [hasGyro, config.useGyro]);

  const requestGyroPermission = useCallback(
    () => requestDeviceOrientationPermission(),
    [],
  );

  const getOffset = useCallback((): [number, number] => {
    const [cx, cy] = currentRef.current;
    // シェーダ側は u_offset.x>0 で画像左, u_offset.y>0 で画像下。
    // OFF（追従）: 入力方向に画像を動かしたいので X だけ符号反転で慣習を打ち消す。
    // ON（反転）: 入力と逆向きにしたいので Y だけ符号反転（X はシェーダ慣習がそのまま逆になる）。
    return configRef.current.invertDirection ? [cx, -cy] : [-cx, cy];
  }, []);

  return { getOffset, hasGyro, requestGyroPermission };
}
