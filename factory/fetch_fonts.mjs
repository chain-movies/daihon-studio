#!/usr/bin/env node
/* google/fonts リポジトリから TTF を取得し telop/fontcache/fonts.css を生成する（レンダリング用ローカルキャッシュ）
   node factory/fetch_fonts.mjs   … 既にあるファイルはスキップ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { FONTS } = createRequire(import.meta.url)(path.join(ROOT, 'telop', 'designs.js'));
const dir = path.join(ROOT, 'telop', 'fontcache'); fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
const base = 'https://raw.githubusercontent.com/google/fonts/main/';
const css = [];
let fail = 0;
for (const [family, info] of Object.entries(FONTS)) {
  for (const f of info.files) {
    const name = path.basename(f.p);
    const dest = path.join(dir, 'files', name);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
      const r = spawnSync('curl', ['-gsSL', '-m', '120', '--retry', '3', '-o', dest, '-w', '%{http_code}', base + f.p], { encoding: 'utf8' });
      if (r.stdout.trim() !== '200') { console.error('FAIL', family, f.p, r.stdout, r.stderr); fs.rmSync(dest, { force: true }); fail++; continue; }
      console.log('✔', family, name, (fs.statSync(dest).size / 1e6).toFixed(1) + 'MB');
    }
    css.push(`@font-face{font-family:"${family}";font-weight:${f.w};font-style:normal;src:url("files/${name}") format("truetype");}`);
  }
}
fs.writeFileSync(path.join(dir, 'fonts.css'), css.join('\n') + '\n');
console.log(`fonts.css written (${css.length} faces, ${fail} failed)`);
process.exit(fail ? 1 : 0);
