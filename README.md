# Depth Parallax Demo

ブラウザ完結型の単眼深度推定デモです。

画像をアップロードすると Depth Anything V2 Small を利用してブラウザ内で深度マップを生成し、
マウス/タッチ/ジャイロ操作で前景と背景の視差効果が得られる、インタラクティブ写真に変換します。

[デモはこちら](https://soltune.github.io/depthparallax/)

---


## セットアップ

```bash
# 依存インストール
npm install

# モデルファイルを取得（初回のみ）
npm run download:model

# 開発サーバー起動
npm run dev
```

### モデルファイルについて

`npm run download:model` は `onnx-community/depth-anything-v2-small` リポジトリから
以下を `public/models/depth-anything-v2-small/` に取得します:

- `onnx/model_q4f16.onnx` (q4f16 量子化版、約 19MB)
- `config.json`
- `preprocessor_config.json`

---

## ビルド・プレビュー

```bash
npm run build
npm run preview
```

---

## ライセンス

- コード: MIT
- 利用モデル: Apache-2.0（`onnx-community/depth-anything-v2-small`）
- 同梱サンプル画像: [Unsplash License](https://unsplash.com/license)
  - `sample-01.jpg` — [Blake Verdoorn](https://unsplash.com/@blakeverdoorn) / [Gray concrete bridge and waterfalls during daytime](https://unsplash.com/photos/gray-concrete-bridge-and-waterfalls-during-daytime-cssvEZacHvQ)
  - `sample-02.jpg` — [Jonathan Borba](https://unsplash.com/@jonathanborba) / [Woman in black long sleeve shirt sitting on white couch](https://unsplash.com/photos/woman-in-black-long-sleeve-shirt-sitting-on-white-couch-n1B6ftPB5Eg)
  - `sample-03.jpg` — [Alex Shutin](https://unsplash.com/@fiveamstories) / [Aerial photography of buildings](https://unsplash.com/photos/aerial-photography-of-buildings-XsC0GHXi-8k)
