/** DeviceOrientationEvent（ジャイロ）の許可リクエスト共通ユーティリティ。 */

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

/**
 * iOS 13+ 等の許可ダイアログを要求する（ユーザー操作イベントのハンドラから呼ぶこと）。
 * 非対応は false、requestPermission を持つ（iOS 13+）なら granted 判定、不要なブラウザは許可済み扱いで true。
 */
export async function requestDeviceOrientationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
    return false;
  }
  const DOE = window.DeviceOrientationEvent as DeviceOrientationEventWithPermission;
  if (typeof DOE.requestPermission === 'function') {
    try {
      const perm = await DOE.requestPermission();
      return perm === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}
