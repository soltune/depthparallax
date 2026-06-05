/** 日本語 locale。表示文字列の集約先。型 {@link Dictionary} を満たす。 */
import type { Dictionary } from '../index';

export const ja: Dictionary = {
  lang: { ja: 'JP', en: 'EN', selectAria: '言語' },
  app: {
    backend: 'Backend',
    backendHint: '推論バックエンドを変更します。深度表示が正しくない場合は WASM に切り替えてみてください。',
    backendSelectAria: '推論バックエンドを選択',
    errorPrefix: 'エラー',
    reload: '再読み込み',
    dismissError: 'エラーを閉じる',
    inputPreview: '入力プレビュー',
    loadingImage: '画像を読み込み中…',
    processing: '処理中…',
    analyzingDepth: '奥行きを解析中…',
    cancel: 'キャンセル',
    footerModel: 'Model: Depth Anything V2 Small (q4f16)',
    inferenceTime: '推論時間: {ms} ms / 深度: {w}×{h}',
    github: 'GitHub でソースを見る',
  },
  samples: { outdoor: '屋外風景', portrait: 'ポートレート', city: '都市夜景' },
  progress: {
    downloading: 'モデルをダウンロード中（1/2）',
    preparing: 'モデルを準備中（2/2）',
    analyzing: '奥行きを解析中…',
  },
  dropzone: {
    pickAria: '画像をクリックして選択',
    cta: '画像をドロップ / クリックして選択',
    formats: 'JPG・PNG・WebP / 最大 10MB',
    trySamples: 'サンプルを試す',
    capture: '📷 撮影',
  },
  picker: {
    sectionAria: '画像',
    change: '画像を変更',
    selectAnother: '別の画像を選ぶ',
    collapseAria: '画像セクションを折り畳む',
    fromFile: 'ファイルから選択',
    capture: '📷 撮影',
  },
  effectPanel: {
    groupFilter: 'フィルター',
    groupMotion: '動き・演出',
    groupsAria: 'エフェクトグループ',
    noEffect: 'エフェクトなし',
    scrollLeft: '左にスクロール',
    scrollRight: '右にスクロール',
    noParams: '調整できる項目はありません',
    reset: '初期値に戻す',
  },
  viewMode: { aria: '操作モード', parallax: '視差', orbit: '3D' },
  controlBar: {
    strength: '視差の強さ',
    gyro: 'ジャイロ',
  },
  orbit: {
    params: {
      depthScale: '奥行きの強さ',
      autoRotate: '自動回転',
    },
    autoRotateLabel: '自動回転',
  },
  common: { play: '再生', stop: '停止', playButton: '▶ 再生', stopButton: '⏸ 停止' },
  dolly: { autoplay: '自動再生', progressAria: 'ドリーズーム再生進行' },
  focal: { label: '焦点深度', auto: '自動', autoHint: '自動計測した位置にリセット' },
  miniPrimary: {
    groupAria: '現在の状態と主要パラメータ',
    modeAria: '現在のモード',
    noEffect: 'エフェクト未選択',
    dollyPlay: 'ドリーズームを再生',
    dollyStop: 'ドリーズーム自動再生を停止',
  },
  depthMap: {
    showToggle: '深度マップを表示',
    enhanceToggle: '深度コントラスト強調',
    enhanceTooltip:
      '奥行きの分布が偏っている画像で、被写体内・背景内の凹凸を均等に展開します（ヒストグラム平坦化）',
    pipAria: '深度マップを拡大表示',
    modalAria: '深度マップ詳細',
    close: '閉じる',
    caption: '深度マップ',
    near: '手前',
    far: '奥',
  },
  bottomSheet: { expand: 'シートを展開', collapse: 'シートを下げる' },
  webglError: {
    title: 'WebGL2 レンダラーを初期化できませんでした',
    body: 'この環境では WebGL2 / FBO がサポートされていない可能性があります。',
  },
  effects: {
    parallax: { name: '視差のみ' },
    fog: {
      name: '霧',
      params: { fogColor: '霧の色', fogDensity: '濃さ', fogCurve: '奥行きへの集中' },
    },
    scanline: {
      name: 'CRT風',
      params: { lineCount: 'ライン数', lineIntensity: '濃さ', scanSpeed: '流れる速さ' },
    },
    chromatic: {
      name: '色ずれ（色収差）',
      params: { aberration: 'ずれの強さ', focalDepth: '焦点深度' },
    },
    neon: {
      name: 'ネオングロー',
      params: { glowColor: 'グロー色', edgeThreshold: 'エッジ閾値', glowIntensity: '強さ' },
    },
    anaglyph: {
      name: '赤青メガネ用 3D',
      params: { eyeSeparation: '左右の視差（px）' },
    },
    dof: {
      name: '背景ぼかし（被写界深度）',
      params: {
        focalDepth: '焦点深度',
        focalAuto: '焦点深度を自動',
        maxBlurRadius: 'ぼかしの強さ（px）',
      },
    },
    tiltshift: {
      name: 'ミニチュア風',
      params: {
        focalDepth: '焦点深度',
        focalAuto: '焦点深度を自動',
        focalBandWidth: '焦点帯の幅',
        maxBlurRadius: 'ぼかしの強さ（px）',
        saturationBoost: '彩度倍率',
      },
    },
    dolly: {
      name: 'ドリーズーム',
      params: {
        dollyAmount: '効果の強さ',
        dollyFocalDepth: '焦点深度',
        dollyFocalAuto: '焦点を自動で合わせる',
        dollySpeed: '再生速度',
      },
      bipolar: { dollyAmount: { negative: '広角', positive: '望遠' } },
    },
    particles: {
      name: 'パーティクル',
      params: {
        particleType: '種類',
        particleCount: '個数',
        fallSpeed: '落下速度',
        windSway: '横揺れ',
      },
      options: { particleType: ['❄ 雪', '☂ 雨', '🌸 花びら', '✨ 蛍'] },
    },
  },
};
