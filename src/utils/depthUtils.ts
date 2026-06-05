/**
 * 深度マップ正規化ユーティリティ。disparity（大きい値=近い）→ depth（0=手前, 1=奥）の
 * 方向反転と正規化をここに集約する。normalize は線形 min-max、normalizeCdf はランクベース
 * （ヒストグラム平坦化）でバイモーダル分布のクラスタ内コントラストを展開する。
 */

/** disparity（大きい値=近い）を min-max 正規化し depth（0=手前, 1=奥）へ方向反転する。 */
export function normalize(raw: Float32Array): Float32Array {
  const length = raw.length;
  if (length === 0) {
    return new Float32Array(0);
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < length; i++) {
    const v = raw[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const out = new Float32Array(length);
  const range = max - min;
  if (range <= 0 || !Number.isFinite(range)) {
    out.fill(0.5);
    return out;
  }

  const invRange = 1 / range;
  for (let i = 0; i < length; i++) {
    // disparity → depth へ方向反転
    out[i] = 1 - (raw[i] - min) * invRange;
  }
  return out;
}

/**
 * CDF（ヒストグラム平坦化）ベースの正規化。線形 min-max がバイモーダル分布で空の中央
 * レンジに出力幅を浪費するのに対し、値が密集したクラスタほど出力幅を多く割り当て凹凸を
 * 強調する（平坦領域では推論ノイズも増幅する副作用あり）。タイは midrank で扱い banding
 * を防ぐ。入出力は normalize と同じ。
 */
export function normalizeCdf(raw: Float32Array): Float32Array {
  const length = raw.length;
  if (length === 0) {
    return new Float32Array(0);
  }
  if (length === 1) {
    const out = new Float32Array(1);
    out[0] = 0.5;
    return out;
  }

  // raw 昇順にソートした元 index 列
  const indices = new Uint32Array(length);
  for (let i = 0; i < length; i++) indices[i] = i;
  const arr = Array.from(indices);
  arr.sort((a, b) => raw[a] - raw[b]);

  const out = new Float32Array(length);
  const invMax = 1 / (length - 1);

  // タイは midrank（タイ範囲の (start + end - 1) / 2 を全員に与える）
  let i = 0;
  while (i < length) {
    const startIdx = arr[i];
    const value = raw[startIdx];
    let j = i + 1;
    while (j < length && raw[arr[j]] === value) j++;
    const midRank = (i + j - 1) / 2;
    const normalized = midRank * invMax;
    const depth = 1 - normalized;
    for (let k = i; k < j; k++) {
      out[arr[k]] = depth;
    }
    i = j;
  }

  return out;
}

/**
 * 「深度コントラスト強調」本体。素の normalizeCdf は背景クラスタに出力幅を奪われ背景が
 * 手前へ寄るため 2 段で補正する: (1) 線形 normalize と CDF を cdfMix でブレンドし CDF の
 * 背景支配を弱める、(2) near factor f=1-depth に f^nearGamma を掛け背景を奥へアンカーし
 * 手前のクラスタ内コントラストを立てる。固定値 nearGamma=1.4 / cdfMix=0.75 で運用。
 */
export function normalizeCdfGamma(
  raw: Float32Array,
  nearGamma: number,
  cdfMix = 0.5,
): Float32Array {
  const lin = normalize(raw);
  const cdf = normalizeCdf(raw);
  const length = lin.length;
  const out = new Float32Array(length);
  const g = Math.max(0.01, nearGamma);
  const mix = Math.min(1, Math.max(0, cdfMix));
  for (let i = 0; i < length; i++) {
    // (1) 線形 ↔ CDF ブレンド
    const d = lin[i] * (1 - mix) + cdf[i] * mix;
    // (2) near factor にガンマ
    const f = 1 - d;
    out[i] = 1 - Math.pow(f, g);
  }
  return out;
}
