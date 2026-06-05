// dist/ をビルドして GitHub Pages（gh-pages ブランチ）へ公開する。実行: npm run pages
//
// 前提: origin remote が公開先リポジトリを指す / GitHub Pages の source が「gh-pages / root」（初回のみ設定）。
// 流れ: origin チェック → models 未取得なら download:model → npm run build → dist/.nojekyll 生成 → gh-pages publish。
//   history: false … 毎回 ~40MB を単一コミットで上書き（履歴肥大回避、ソースは main にあり再生成可能）。

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ghpages from 'gh-pages';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const modelDir = resolve(root, 'public/models/depth-anything-v2-small');

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: root });
}

function toPagesUrl(remote) {
  // git@github.com:owner/repo.git / https://github.com/owner/repo(.git) の両方に対応
  const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) return '';
  const [, owner, repo] = m;
  return `https://${owner}.github.io/${repo}/`;
}

// 1. origin remote チェック
let originUrl = '';
try {
  originUrl = execSync('git remote get-url origin', { cwd: root }).toString().trim();
} catch {
  console.error(
    '\n[deploy-pages] origin remote is not configured.\n' +
      '  e.g. git remote add origin git@github.com:soltune/depthparallax.git\n',
  );
  process.exit(1);
}
console.log(`[deploy-pages] origin = ${originUrl}`);

// 2. モデル未取得なら取得
if (!existsSync(modelDir)) {
  console.log('[deploy-pages] public/models/ not found; running download:model');
  run('npm run download:model');
}

// 3. 本番ビルド
run('npm run build');

// 4. .nojekyll を生成（dotfiles: true で publish される）
writeFileSync(resolve(distDir, '.nojekyll'), '');
console.log('[deploy-pages] generated dist/.nojekyll');

// 5. gh-pages publish
const message = `deploy: ${new Date().toISOString()} [skip ci]`;
console.log('[deploy-pages] publishing to gh-pages (branch: gh-pages, history: false)');
ghpages.publish(
  distDir,
  {
    dotfiles: true,
    history: false,
    message,
  },
  (err) => {
    if (err) {
      console.error('[deploy-pages] publish failed:', err.message ?? err);
      process.exit(1);
    }
    console.log('\n[deploy-pages] done ✅');
    const pagesUrl = toPagesUrl(originUrl);
    if (pagesUrl) console.log(`  Pages URL (approx.): ${pagesUrl}`);
    console.log('  Note: on first deploy, set source to "gh-pages / root" in GitHub Settings > Pages');
  },
);
