// 使い方動画・BASE 商品画像用の「テロップメーカー画面キャプチャ」を自動生成
//   node factory/gen_howto_caps.mjs                 # 最新パック（PACKS の最後）
//   node factory/gen_howto_caps.mjs --pack pet-vol2 # 指定パック
//   node factory/gen_howto_caps.mjs --all           # 画像が無いパック全部
// 出力: factory/howto/<pack>/{cap4_maker,cap4b_batch,cap5_portrait}.png（1600×1000）
//   cap4  … 本文を打ち替え、色違いを 1 つ変えたプレビュー（絵コンテ カット 4）
//   cap4b … 一括書き出し欄に台本 3 行を貼った状態（カット 4b）
//   cap5  … 9:16 縦に切り替えた状態（カット 5）
// 絵コンテ: factory/bundle/howto-storyboard.md。Playwright は /opt/node22/lib/node_modules
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const root = '/home/user/daihon-studio';
const outRoot = path.join(root, 'factory/howto');
const D = require(root + '/telop/designs.js');
const argv = process.argv.slice(2);
const packIds = Object.keys(D.PACKS);
let packs;
if (argv.includes('--all')) packs = packIds.filter((p) => !fs.existsSync(path.join(outRoot, p)));
else if (argv.includes('--pack')) packs = [argv[argv.indexOf('--pack') + 1]];
else packs = [packIds[packIds.length - 1]];
for (const p of packs) if (!D.PACKS[p]) { console.error('unknown pack', p); process.exit(1); }

const PORT = 8767;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' };
const srv = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(PORT);

const css = fs.readFileSync(root + '/telop/fontcache/fonts.css', 'utf8').split('url("files/').join(`url("http://localhost:${PORT}/telop/fontcache/files/`);
const designsSrc = fs.readFileSync(root + '/telop/designs.js', 'utf8');
const indexSrc = fs.readFileSync(root + '/telop/index.html', 'utf8').replace('/* @DEMO */ true; /* @DEMO */', 'false; // 製品版（キャプチャ用）');

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: css }));
await page.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.JSZip=function(){};' }));
let curPack = null;
await page.route(`http://localhost:${PORT}/telop/designs.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: designsSrc + `\n;(function(){const P=${JSON.stringify(curPack)};const A=TelopDesigns.DESIGNS;const keep=A.filter(d=>d.pack===P);A.splice(0,A.length,...keep);})();` }));
await page.route(`http://localhost:${PORT}/telop/index.html`, (r) => r.fulfill({ contentType: 'text/html', body: indexSrc }));

const pick = (designs) => {
  const pref = ['ポイント', '見出し', '章タイトル', 'ラベル'];
  for (const c of pref) { const i = designs.findIndex((d) => d.category === c && d.tag); if (i >= 0) return i; }
  for (const c of pref) { const i = designs.findIndex((d) => d.category === c); if (i >= 0) return i; }
  return Math.min(5, designs.length - 1);
};

for (const pk of packs) {
  curPack = pk;
  const designs = D.DESIGNS.filter((d) => d.pack === pk);
  const dir = path.join(outRoot, pk); fs.mkdirSync(dir, { recursive: true });
  await page.goto(`http://localhost:${PORT}/telop/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#designs .dcard');
  await page.waitForTimeout(1500);
  await page.click('#bgsel button[data-v="dark"]');

  // cap4: デザインを選び、本文を打ち替え、色違いを 1 つ変える
  const idx = pick(designs);
  await page.locator('#designs .dcard').nth(idx).click();
  await page.fill('#text', '文字は打ち替えられます');
  const sw = page.locator('#variants .sw');
  if (await sw.count() > 1) await sw.nth(1).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(dir, 'cap4_maker.png') });

  // cap4b: 一括書き出し欄に台本 3 行
  await page.fill('#batch', '結論から言うと\nポイントは 3 つ\n今日のまとめ');
  await page.locator('#batch').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, 'cap4b_batch.png') });

  // cap5: 9:16 縦
  await page.click('#aspect button[data-v="916"]');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(dir, 'cap5_portrait.png') });

  console.log(`✔ ${pk}  ${designs[idx].name}  → ${path.relative(root, dir)}/ (3 枚)`);
}
await browser.close(); srv.close();
