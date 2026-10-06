// BASE 用商品画像（1280×1280 × 7枚）を factory/gallery/<pack>/ に生成
//   node factory/gen_gallery.mjs          # 画像が無いパックだけ
//   node factory/gen_gallery.mjs --all    # 全パック作り直し
// Playwright は /opt/node22/lib/node_modules（Actions の実行環境では npm i playwright 後にパスを変える）
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const root = '/home/user/daihon-studio';
const outRoot = path.join(root, 'factory/gallery');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' };
const srv = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(8766);
const D = require(root + '/telop/designs.js');
const packs = process.argv[2] === '--all' ? Object.keys(D.PACKS) : Object.keys(D.PACKS).filter((p) => !fs.existsSync(path.join(outRoot, p)));
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } })).newPage();
const css = fs.readFileSync(root + '/telop/fontcache/fonts.css', 'utf8').split('url("files/').join('url("http://localhost:8766/telop/fontcache/files/');
await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: css }));
await page.goto('http://localhost:8766/apps/base-gallery/', { waitUntil: 'domcontentloaded' });
const names = ['01_cover', '02_designs', '03_portrait', '04_howto', '05_contents', '06_compare', '07_faq'];
for (const pk of packs) {
  await page.selectOption('#pack', pk); await page.fill('#price', String(D.PACKS[pk].price)); await page.fill('#bundlePrice', '9980');
  await page.click('#gen');
  await page.waitForFunction(() => /完了|エラー/.test(document.querySelector('#status').textContent), null, { timeout: 240000 });
  const dir = path.join(outRoot, pk); fs.mkdirSync(dir, { recursive: true });
  const n = await page.evaluate(() => document.querySelectorAll('#grid canvas').length);
  for (let i = 0; i < n; i++) {
    const data = await page.evaluate((i) => document.querySelectorAll('#grid canvas')[i].toDataURL('image/jpeg', 0.9), i);
    fs.writeFileSync(path.join(dir, `${pk}_${names[i]}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  }
  console.log(pk, n, await page.textContent('#status'));
}
await browser.close(); srv.close();
