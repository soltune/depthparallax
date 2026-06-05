import { useEffect, useState } from 'react';

/**
 * 画面レイアウトの判定。
 * - 'pc': 横幅が十分（左 canvas / 右ペイン方式）
 * - 'mobile-landscape': モバイル横持ち（PC レイアウトを適用）
 * - 'mobile-portrait': モバイル縦持ち（縦並び BottomSheet）
 */
export type ViewportLayout = 'pc' | 'mobile-portrait' | 'mobile-landscape';

const PC_QUERY = '(min-width: 900px)';
const MOBILE_LANDSCAPE_QUERY =
  '(orientation: landscape) and (min-height: 380px) and (max-width: 899px)';

function detectLayout(): ViewportLayout {
  if (typeof window === 'undefined' || !window.matchMedia) return 'pc';
  if (window.matchMedia(PC_QUERY).matches) return 'pc';
  if (window.matchMedia(MOBILE_LANDSCAPE_QUERY).matches) return 'mobile-landscape';
  return 'mobile-portrait';
}

export function useViewportLayout(): ViewportLayout {
  const [layout, setLayout] = useState<ViewportLayout>(detectLayout);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const pcMql = window.matchMedia(PC_QUERY);
    const landscapeMql = window.matchMedia(MOBILE_LANDSCAPE_QUERY);
    const update = () => setLayout(detectLayout());
    pcMql.addEventListener('change', update);
    landscapeMql.addEventListener('change', update);
    return () => {
      pcMql.removeEventListener('change', update);
      landscapeMql.removeEventListener('change', update);
    };
  }, []);

  return layout;
}

/** 'pc' と 'mobile-landscape' をまとめて「左 canvas / 右ペイン方式」とみなすヘルパ。 */
export function isWideLayout(layout: ViewportLayout): boolean {
  return layout === 'pc' || layout === 'mobile-landscape';
}
