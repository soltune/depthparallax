#!/usr/bin/env node
/**
 * 非 JSEP 版 onnxruntime-web の WASM/MJS を public/ort/ にコピーする。
 *
 * JSEP 版 (.jsep.wasm, 21MB) は iOS Safari (WebKit 26) で推論後もメモリが解放されず WebContent が
 * kill される重大バグがある (onnxruntime#26827, transformers.js#1242)。非 JSEP 版 (11MB) は同問題が無く、
 * WebGPU 加速は失うが iOS では WebGPU OFF でも JSEP WASM 自体が問題を起こすため非 JSEP に倒すのが正解
 * （#26827 でも wasmPaths による非 JSEP 指定が公式 workaround）。
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const srcDir = resolve(
  projectRoot,
  'node_modules/onnxruntime-web/dist',
);
const dstDir = resolve(projectRoot, 'public/ort');

// [src, dst] のペア。.mjs は素の Apache/Nginx で application/octet-stream 配信になり Safari の ES module
// MIME 検査に弾かれる（"'application/octet-stream' is not a valid JavaScript MIME type"）。.js なら全サーバで
// application/javascript として配信される。中身は不変。
const FILES = [
  ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.wasm'],
  ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.js'],
];

if (!existsSync(srcDir)) {
  console.error(
    `[copy-ort-wasm] onnxruntime-web not found at ${srcDir}. Run npm install first.`,
  );
  process.exit(1);
}

mkdirSync(dstDir, { recursive: true });

for (const [srcName, dstName] of FILES) {
  const src = resolve(srcDir, srcName);
  const dst = resolve(dstDir, dstName);
  if (!existsSync(src)) {
    console.error(`[copy-ort-wasm] missing source: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, dst);
  const size = (statSync(dst).size / 1024 / 1024).toFixed(2);
  const renamed = srcName !== dstName ? ` (renamed from ${srcName})` : '';
  console.log(`[copy-ort-wasm] public/ort/${dstName} (${size} MB)${renamed}`);
}
