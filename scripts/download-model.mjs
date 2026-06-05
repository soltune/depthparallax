#!/usr/bin/env node
/**
 * Depth Anything V2 Small (q4f16) と前処理設定を HuggingFace Hub から
 * public/models/depth-anything-v2-small/ へダウンロードする。
 * 自己ホストで COEP 切替時の整合性リスクを避け HTTP キャッシュを活用。サイズが妥当な既存ファイルはスキップ。
 */

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TARGET_DIR = join(PROJECT_ROOT, 'public', 'models', 'depth-anything-v2-small');

const REPO = 'onnx-community/depth-anything-v2-small';
const REVISION = 'main';
const BASE_URL = `https://huggingface.co/${REPO}/resolve/${REVISION}`;

/**
 * @typedef {{ relativePath: string; minBytes: number }} Asset
 */

/** @type {Asset[]} */
const ASSETS = [
  { relativePath: 'onnx/model_q4f16.onnx', minBytes: 10 * 1024 * 1024 }, // ~18-26MB
  // config.json は実際には極小（`{"model_type": "depth_anything"}` のみ）の場合がある
  { relativePath: 'config.json', minBytes: 10 },
  { relativePath: 'preprocessor_config.json', minBytes: 50 },
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * @param {Asset} asset
 */
async function downloadAsset(asset) {
  const url = `${BASE_URL}/${asset.relativePath}`;
  const targetPath = join(TARGET_DIR, asset.relativePath);

  if (existsSync(targetPath)) {
    const size = statSync(targetPath).size;
    if (size >= asset.minBytes) {
      console.log(`[skip ] ${asset.relativePath} (${formatBytes(size)} already present)`);
      return;
    }
    console.log(`[redo ] ${asset.relativePath} (existing ${formatBytes(size)} < expected min)`);
    unlinkSync(targetPath);
  }

  mkdirSync(dirname(targetPath), { recursive: true });

  console.log(`[fetch] ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength) {
    console.log(`        size: ${formatBytes(contentLength)}`);
  }

  const tempPath = `${targetPath}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
  } catch (err) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw err;
  }

  const downloadedSize = statSync(tempPath).size;
  if (downloadedSize < asset.minBytes) {
    unlinkSync(tempPath);
    throw new Error(
      `Downloaded ${asset.relativePath} (${formatBytes(downloadedSize)}) is smaller than expected (${formatBytes(asset.minBytes)}+). Aborting.`,
    );
  }

  // Node の rename はファイルシステム跨ぎでも安全
  const { renameSync } = await import('node:fs');
  renameSync(tempPath, targetPath);
  console.log(`[done ] ${asset.relativePath} (${formatBytes(downloadedSize)})`);
}

async function main() {
  console.log(`Downloading ${REPO}@${REVISION} → ${TARGET_DIR}\n`);
  mkdirSync(TARGET_DIR, { recursive: true });
  for (const asset of ASSETS) {
    await downloadAsset(asset);
  }
  console.log('\nAll model assets are in place.');
}

main().catch((err) => {
  console.error('\nDownload failed:', err.message ?? err);
  process.exit(1);
});
