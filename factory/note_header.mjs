#!/usr/bin/env node
/* =====================================================================
   note 見出し画像ジェネレーター（8/24 サムネ風構成・1280×670）
   仕様: ティールグリーン深緑背景 × 白極太テキスト、キー行は黒箱＋『』オレンジで最大強調、
         左上に黒badge＋白吹き出しbadge、破線円badgeに数字・期限、右にスマホモックで記事の中身3項目、
         左下に白クレジット。HTML → ヘッドレス Chromium で PNG 化。
   使い方: node factory/note_header.mjs spec.json out.png
   spec.json 例:
   { "badge": "AI現場実録", "bubble": "3日目の全記録", "lines": ["AIに", "『毎日1商品』", "作らせてみた"],
     "circle": ["3日で", "6本"], "phone": { "title": "記事の中身", "items": ["何を作ったか", "いくら売れたか", "止まった理由"] },
     "credit": "マッキー｜映像会社経営×AIの現場実録" }
   ===================================================================== */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright() {
  const roots = [null, path.join(process.cwd(), 'node_modules') + '/', '/opt/node22/lib/node_modules/'];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8' }).trim() + '/'); } catch (e) { /* ignore */ }
  for (const r of roots) { try { return (r ? createRequire(r) : require)('playwright'); } catch (e) { /* next */ } }
  throw new Error('playwright not found');
}
const { chromium } = loadPlaywright();
const [specPath, outPath] = process.argv.slice(2);
if (!specPath || !outPath) { console.error('usage: node factory/note_header.mjs spec.json out.png'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// 『』で囲まれた部分をオレンジ強調
const key = (s) => esc(s).replace(/『([^』]*)』/g, '<span class="k">『$1』</span>');

const fontCss = fs.existsSync(path.join(ROOT, 'telop/fontcache/fonts.css'))
  ? fs.readFileSync(path.join(ROOT, 'telop/fontcache/fonts.css'), 'utf8').replace(/url\("files\//g, `url("${pathToFileURL(path.join(ROOT, 'telop/fontcache/files')).href}/`)
  : '';
const lines = spec.lines || [];
const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<style>
${fontCss}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1280px;height:670px;overflow:hidden;font-family:"Noto Sans JP","Zen Kaku Gothic New",sans-serif;color:#fff;
  background:radial-gradient(ellipse at 18% 25%,#1f7a6a 0%,#0f5346 45%,#0a3a32 100%);position:relative}
body:before{content:"";position:absolute;inset:0;background:
  linear-gradient(115deg,rgba(255,255,255,.05) 0 2px,transparent 2px 60px);opacity:.35}
.badges{position:absolute;left:56px;top:44px;display:flex;align-items:center;gap:14px}
.badge{background:#111;color:#fff;font-weight:900;font-size:26px;padding:10px 22px;border-radius:8px;letter-spacing:.06em}
.bubble{position:relative;background:#fff;color:#0f5346;font-weight:900;font-size:24px;padding:10px 20px;border-radius:999px}
.bubble:before{content:"";position:absolute;left:-10px;top:50%;transform:translateY(-50%);border:10px solid transparent;border-right-color:#fff;border-left:0}
.text{position:absolute;left:56px;top:150px;width:780px}
.line{font-weight:900;font-size:78px;line-height:1.22;letter-spacing:.02em;text-shadow:0 4px 0 rgba(0,0,0,.35)}
.line.box{display:inline-block;background:#111;padding:6px 22px;border-radius:10px;margin:8px 0;box-shadow:0 8px 0 rgba(0,0,0,.25)}
.k{color:#ff9a1f}
.circle{position:absolute;left:640px;top:72px;width:150px;height:150px;border:5px dashed #ffd23f;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;transform:rotate(-8deg);background:rgba(0,0,0,.25)}
.circle .a{font-size:22px;font-weight:900;color:#ffd23f}
.circle .b{font-size:44px;font-weight:900;line-height:1;color:#fff}
.phone{position:absolute;right:64px;top:70px;width:300px;height:560px;border-radius:38px;background:#111;padding:14px;box-shadow:0 30px 60px rgba(0,0,0,.45)}
.screen{width:100%;height:100%;border-radius:26px;background:#f7f9fc;color:#1b2a4a;padding:38px 20px 20px;position:relative;overflow:hidden}
.notch{position:absolute;left:50%;top:10px;transform:translateX(-50%);width:110px;height:22px;background:#111;border-radius:12px}
.ptitle{font-size:18px;font-weight:900;color:#0f5346;margin:14px 0 12px;letter-spacing:.06em}
.item{display:flex;gap:10px;align-items:flex-start;background:#fff;border-radius:12px;padding:12px 12px;margin-bottom:10px;box-shadow:0 2px 6px rgba(0,0,0,.06);font-size:17px;font-weight:700;line-height:1.35}
.item .n{flex:0 0 30px;height:30px;border-radius:50%;background:#f5a623;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px}
.more{margin-top:8px;text-align:center;font-size:14px;color:#8a94a6;font-weight:700}
.credit{position:absolute;left:56px;bottom:40px;font-size:24px;font-weight:700;color:#fff;opacity:.95;letter-spacing:.04em}
.credit:before{content:"";display:inline-block;width:14px;height:14px;background:#ff9a1f;border-radius:50%;margin-right:12px;vertical-align:middle}
</style></head><body>
<div class="badges"><div class="badge">${esc(spec.badge || 'AI現場実録')}</div>${spec.bubble ? `<div class="bubble">${esc(spec.bubble)}</div>` : ''}</div>
${spec.circle ? `<div class="circle"><div class="a">${esc(spec.circle[0])}</div><div class="b">${esc(spec.circle[1])}</div></div>` : ''}
<div class="text">${lines.map((l) => `<div class="line${/『/.test(l) ? ' box' : ''}">${key(l)}</div>`).join('')}</div>
<div class="phone"><div class="screen"><div class="notch"></div><div class="ptitle">${esc((spec.phone && spec.phone.title) || '記事の中身')}</div>
${((spec.phone && spec.phone.items) || []).map((it, i) => `<div class="item"><div class="n">${i + 1}</div><div>${esc(it)}</div></div>`).join('')}<div class="more">…続きは本文で</div></div></div>
<div class="credit">${esc(spec.credit || 'マッキー｜映像会社経営×AIの現場実録')}</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 670 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(async () => { try { await document.fonts.ready; } catch (e) {} });
await page.waitForTimeout(300);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
await page.screenshot({ path: outPath, type: 'png' });
await browser.close();
console.log('✔', outPath);
