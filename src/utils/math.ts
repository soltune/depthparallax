/** 数値ユーティリティ。 */

/** v を [lo, hi] に収める。 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
