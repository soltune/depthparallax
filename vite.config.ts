import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // dev のみ HTTPS 化。スマホ実機からの LAN アクセスで WebGPU / iOS ジャイロ /
  // Cache API などの secure context 必須機能を有効化するため。
  // 本番ビルド (`vite build`) では plugin が評価されず、GitHub Pages の
  // 配信物 (dist/) には一切影響しない
  plugins: [react(), ...(mode === 'development' ? [basicSsl()] : [])],
  // GitHub Pages のリポジトリ名サブパス配信用。本番ビルド (production) のときだけ
  // サブパスにし、dev は '/' のまま（ローカル体験を維持）。preview は production 扱いの
  // ため '/depthparallax/' となり、デプロイ環境をローカルで再現できる。
  // env.localModelPath / サンプル画像パスは import.meta.env.BASE_URL に追従するため、
  // この値だけ切り替えればモデル・サンプル参照の解決もそのまま動く。
  base: mode === 'production' ? '/depthparallax/' : '/',
  optimizeDeps: {
    // @huggingface/transformers は ESM 専用のため事前バンドルから除外
    exclude: ['@huggingface/transformers'],
  },
  worker: {
    format: 'es',
  },
  // マルチスレッドWASMを採用する場合のみ、以下を有効化：
  // server: {
  //   headers: {
  //     'Cross-Origin-Opener-Policy': 'same-origin',
  //     'Cross-Origin-Embedder-Policy': 'require-corp',
  //   },
  // },
}));
