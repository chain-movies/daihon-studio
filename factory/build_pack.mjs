#!/usr/bin/env node
/* =====================================================================
   build_pack.mjs — テロップパック(商品)を自動生成する
   使い方:
     node factory/build_pack.mjs --pack tv-vol1            # フル生成 + zip
     node factory/build_pack.mjs --pack tv-vol1 --quick    # 16:9 サンプルのみ（確認用）
     node factory/build_pack.mjs --pack tv-vol1 --out /path/to/out
   出力: factory/out/<pack>/ 以下
     png/16x9/<番号>_<デザイン>_<色>.png       透過PNG（サンプル文字入り）
     png/9x16/...                               縦動画用
     plates/<番号>_<デザイン>_<色>_帯のみ.png   文字なしの帯・ボックスのみ
     preview/contact_sheet.jpg                  商品画像（一覧）
     preview/<番号>_<デザイン>.jpg              各デザインの見本（背景付き）
     テロップメーカー/ (index.html, renderer.js, designs.js)  購入者用アプリ
     README.txt / RECIPE.txt / LICENSE.txt
     listing.md（BASE/BOOTH 用の商品説明文）
     ../<pack>_<日付>.zip
   ===================================================================== */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* fall through */ }
  const g = createRequire('/opt/node22/lib/node_modules/');
  return g('playwright');
}
const { chromium } = loadPlaywright();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const packId = opt('pack', 'tv-vol1');
const quick = !!opt('quick', false);
const outRoot = path.resolve(opt('out', path.join(ROOT, 'factory', 'out')));
const date = opt('date', new Date().toISOString().slice(0, 10));

const Designs = require(path.join(ROOT, 'telop', 'designs.js'));
const pack = Designs.PACKS[packId];
if (!pack) { console.error('unknown pack', packId); process.exit(1); }
const designs = Designs.DESIGNS.filter((d) => d.pack === packId);
if (!designs.length) { console.error('no designs for pack', packId); process.exit(1); }

const out = path.join(outRoot, packId);
fs.rmSync(out, { recursive: true, force: true });
for (const d of ['png/16x9', 'png/9x16', 'plates', 'preview', 'テロップメーカー']) fs.mkdirSync(path.join(out, d), { recursive: true });

const pad2 = (n) => String(n).padStart(2, '0');
const safe = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
const writeDataUrl = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

const launchOpts = {};
if (process.env.HTTPS_PROXY) launchOpts.proxy = { server: process.env.HTTPS_PROXY, bypass: process.env.NO_PROXY || '' };
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, ignoreHTTPSErrors: !!process.env.HTTPS_PROXY });
page.on('requestfailed', (r) => console.error('requestfailed', r.url().slice(0, 100), r.failure() && r.failure().errorText));
page.on('pageerror', (e) => console.error('pageerror', e));
await page.goto(pathToFileURL(path.join(ROOT, 'telop', 'render.html')).href);
await page.waitForFunction(() => window.harnessReady);
// フォントの事前ロード（全デザインのサンプル文字）
await page.evaluate(async (ids) => {
  for (const id of ids) {
    const d = TelopDesigns.DESIGNS.find((x) => x.id === id);
    const spec = TelopRenderer.resolve(d, 0);
    await TelopRenderer.ensureFonts(spec, [d.sample || '', d.sampleSub || '', spec.tag ? spec.tag.text : '']);
  }
}, designs.map((d) => d.id));

const recipes = [];
const previewFiles = [];
let count = 0;
for (let i = 0; i < designs.length; i++) {
  const d = designs[i];
  const variants = d.variants && d.variants.length ? d.variants : [{ name: '' }];
  for (let v = 0; v < variants.length; v++) {
    const vname = variants[v].name ? `_${variants[v].name}` : '';
    const base = `${pad2(i + 1)}_${safe(d.name)}${safe(vname)}`;
    const png169 = await page.evaluate((o) => window.renderOne(o), { designId: d.id, variant: v, width: 1920, height: 1080 });
    writeDataUrl(path.join(out, 'png/16x9', base + '.png'), png169);
    count++;
    if (!quick) {
      const png916 = await page.evaluate((o) => window.renderOne(o), { designId: d.id, variant: v, width: 1080, height: 1920 });
      writeDataUrl(path.join(out, 'png/9x16', base + '.png'), png916);
      count++;
      const spec = Designs.DESIGNS.find((x) => x.id === d.id);
      const hasBox = spec.box && !['none', 'underline'].includes(spec.box.type);
      if (hasBox) {
        const plate = await page.evaluate((o) => window.renderOne(o), { designId: d.id, variant: v, width: 1920, height: 1080, plateOnly: true });
        writeDataUrl(path.join(out, 'plates', base + '_帯のみ.png'), plate);
        count++;
      }
    }
    recipes.push(await page.evaluate(([id, vv]) => window.recipeOf(id, vv), [d.id, v]));
    if (v === 0) previewFiles.push({ file: path.join(out, 'png/16x9', base + '.png'), name: d.name, category: d.category });
  }
  console.log(`✔ ${pad2(i + 1)} ${d.name} (${variants.length} variants)`);
}

/* ---------- プレビュー画像（背景付き）＆ コンタクトシート ---------- */
await page.setViewportSize({ width: 1920, height: 1080 });
const bgCss = (i) => {
  const bgs = [
    'linear-gradient(135deg,#1c2541,#3a506b)', 'linear-gradient(135deg,#2b2d42,#8d99ae)', 'linear-gradient(135deg,#0b3d2e,#1e6f5c)',
    'linear-gradient(135deg,#4a1942,#893168)', 'linear-gradient(135deg,#1a1a1a,#4b4b4b)', 'linear-gradient(135deg,#0f3460,#16213e)',
  ];
  return bgs[i % bgs.length];
};
for (let i = 0; i < previewFiles.length; i++) {
  const p = previewFiles[i];
  const b64 = fs.readFileSync(p.file).toString('base64');
  await page.setContent(`<html><body style="margin:0;width:1920px;height:1080px;background:${bgCss(i)};position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(255,255,255,.12),transparent 60%)"></div>
    <img src="data:image/png;base64,${b64}" style="position:absolute;inset:0;width:1920px;height:1080px">
    <div style="position:absolute;left:48px;top:40px;font:700 34px/1.3 sans-serif;color:rgba(255,255,255,.85);letter-spacing:.06em">${pad2(i + 1)} ${p.category}｜${p.name}</div>
    <div style="position:absolute;right:48px;top:44px;font:700 22px sans-serif;color:rgba(255,255,255,.55);letter-spacing:.2em">${pack.name}</div>
  </body></html>`);
  await page.screenshot({ path: path.join(out, 'preview', `${pad2(i + 1)}_${safe(p.name)}.jpg`), type: 'jpeg', quality: 88 });
}
// コンタクトシート（商品トップ画像）
{
  const cols = 3, tileW = 600, tileH = 338, gap = 20, headerH = 150;
  const rows = Math.ceil(previewFiles.length / cols);
  const W = cols * tileW + (cols + 1) * gap, H = headerH + rows * (tileH + gap) + gap;
  await page.setViewportSize({ width: W, height: H });
  const tiles = previewFiles.map((p, i) => {
    const b64 = fs.readFileSync(p.file).toString('base64');
    return `<div style="position:relative;width:${tileW}px;height:${tileH}px;background:${bgCss(i)};border-radius:10px;overflow:hidden">
      <img src="data:image/png;base64,${b64}" style="position:absolute;inset:0;width:${tileW}px;height:${tileH}px">
      <div style="position:absolute;left:12px;top:10px;font:700 15px sans-serif;color:rgba(255,255,255,.85)">${pad2(i + 1)} ${p.name}</div></div>`;
  }).join('');
  await page.setContent(`<html><body style="margin:0;background:#101010;width:${W}px;height:${H}px;font-family:sans-serif">
    <div style="height:${headerH}px;display:flex;align-items:center;justify-content:space-between;padding:0 ${gap}px;color:#fff">
      <div><div style="font-size:44px;font-weight:900;letter-spacing:.02em">${pack.name}</div>
      <div style="font-size:20px;color:#bbb;margin-top:8px">${designs.length}デザイン / ${count}ファイル ・ 透過PNG（16:9・9:16）＋ 帯のみ ＋ テロップメーカー（自分の文字で書き出し）</div></div>
      <div style="font-size:18px;color:#888;letter-spacing:.2em">Chain-Movies</div></div>
    <div style="display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:${gap}px;padding:0 ${gap}px ${gap}px">${tiles}</div></body></html>`);
  await page.screenshot({ path: path.join(out, 'preview', 'contact_sheet.jpg'), type: 'jpeg', quality: 90, fullPage: true });
}
await browser.close();

/* ---------- 同梱物 ---------- */
for (const f of ['index.html', 'renderer.js', 'designs.js']) {
  let src = fs.readFileSync(path.join(ROOT, 'telop', f), 'utf8');
  if (f === 'index.html') src = src.replace('/* @DEMO */ true; /* @DEMO */', 'false; // 製品版'); // 購入者向けは透かしなし・制限なし
  fs.writeFileSync(path.join(out, 'テロップメーカー', f), src);
}
fs.writeFileSync(path.join(out, 'RECIPE.txt'), `${pack.name}\nPremiere Pro / CapCut / DaVinci で手動再現するための設定値（1920×1080基準）\nエッセンシャルグラフィックスの「アピアランス」に同じ値を入れると近い見た目になります。\n\n` + recipes.join('\n\n') + '\n');
fs.writeFileSync(path.join(out, 'README.txt'), readme());
fs.writeFileSync(path.join(out, 'LICENSE.txt'), license());
fs.writeFileSync(path.join(out, 'listing.md'), listing());

const zipName = `${packId}_${date}.zip`;
const zipPath = path.join(outRoot, zipName);
fs.rmSync(zipPath, { force: true });
execSync(`cd "${outRoot}" && zip -qr "${zipName}" "${packId}" -x "*/listing.md" "*/preview/*"`);
const size = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n📦 ${zipPath} (${size} MB)  files: ${count}`);
fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ pack: packId, name: pack.name, date, designs: designs.length, files: count, zip: zipName, sizeMB: Number(size) }, null, 2));

function readme() {
  return `${pack.name}
=====================================
制作: Chain-Movies株式会社
生成日: ${date}

■ 内容
- png/16x9/   横動画用（1920×1080）透過PNG。サンプル文字入り
- png/9x16/   縦動画用（1080×1920）透過PNG。ショート/リール向け
- plates/     文字なしの「帯・ボックスのみ」透過PNG。上に自分のテキストを載せて使えます
- テロップメーカー/  index.html をブラウザで開くと、好きな文字で同じデザインのPNGを書き出せます
                    （台本を貼って一括書き出しも可能。フォントはGoogle Fontsから読み込むためネット接続が必要）
- RECIPE.txt  Premiere Pro のエッセンシャルグラフィックスで手動再現するための設定値

■ 使い方（Premiere Pro）
1. png フォルダごとプロジェクトに読み込む
2. タイムラインの映像の上のトラックに置く（透過PNGなのでそのまま重なります）
3. 位置や大きさは「エフェクトコントロール」の モーション で調整
4. 文字を変えたい場合は「テロップメーカー」で書き出し直すか、plates（帯のみ）の上に
   エッセンシャルグラフィックスのテキストを RECIPE.txt の値で作成してください

■ CapCut / DaVinci / iMovie
- 画像として読み込み、映像の上のレイヤーに配置するだけで使えます

■ 注意
- 特定のテレビ番組・企業のロゴやデザインを複製したものではありません（「〜風」の汎用デザインです）
- 使用フォントはすべて Google Fonts のオープンライセンス（SIL OFL）フォントです
`;
}
function license() {
  return `利用規約 / License
- 購入者本人（または購入した法人）の映像作品（商用含む）で自由に利用できます。クレジット表記は不要です
- YouTube・SNS・広告・企業VP・イベント映像など用途は問いません
- 禁止: 素材そのもの（PNG・アプリ）の再配布・転売・二次配布、素材集としての再パッケージ
- 本商品の性質上、購入後の返品・返金はできません
- 使用フォント: Google Fonts 提供の SIL Open Font License フォント（レンダリング結果の画像を配布しています。フォントファイル自体は同梱していません）
© Chain-Movies Inc.
`;
}
function listing() {
  const cats = [...new Set(designs.map((d) => d.category))];
  const names = designs.map((d, i) => `${pad2(i + 1)}. ${d.name}（${(d.variants || []).map((v) => v.name).join('・')}）`).join('\n');
  return `# ${pack.name}

**価格（推奨）: ¥${pack.price.toLocaleString()}**（同カテゴリの相場: 2,000〜3,000円）

## 商品名（BASE/BOOTH用）
${pack.name}｜${designs.length}デザイン×色違い ${count}点 透過PNG＋テロップメーカー付き

## キャッチ
テレビ番組でよく見る「あのテロップ」を、貼るだけで再現。
バラエティ・ニュース・情報番組・ドキュメンタリーなど ${cats.length} ジャンル ${designs.length} デザインを収録。
文字を変えたい人のために、ブラウザで動く「テロップメーカー」を同梱。台本を貼れば全行分を一括でPNG書き出しできます。

## 商品説明
■ こんな人に
- YouTube / ショート動画のテロップに「テレビっぽさ」が欲しい
- Premiere Pro の文字装飾を毎回ゼロから作るのが面倒
- CapCut・DaVinci・iMovie でも使える素材が欲しい（画像を置くだけ）

■ 収録内容（${count}ファイル）
- 16:9（1920×1080）透過PNG ${designs.length}デザイン × 色違い
- 9:16（1080×1920）縦動画用 透過PNG
- 文字なし「帯・ボックスのみ」PNG（自分のテキストを載せて使える）
- テロップメーカー（HTMLアプリ）: 好きな文字で同デザインを書き出し／台本一括書き出し
- RECIPE.txt: Premiere のエッセンシャルグラフィックスで再現するための設定値

■ 収録デザイン
${names}

■ 対応ソフト
Premiere Pro / After Effects / CapCut / DaVinci Resolve / Final Cut Pro / iMovie / Canva など、画像を読み込めるものすべて

■ ライセンス
商用利用OK・クレジット不要。素材そのものの再配布・転売は禁止。

■ 注意
特定の番組・局のロゴやデザインを複製したものではなく、ジャンルの「雰囲気」を再現した汎用デザインです。
テロップメーカーはフォント読み込みにインターネット接続が必要です。

## タグ
テロップ, テロップ素材, Premiere Pro, プレミアプロ, CapCut, 動画編集, 透過PNG, テレビ風, バラエティ, ニュース, YouTube, ショート動画

## 画像
preview/contact_sheet.jpg（トップ）、preview/*.jpg（各デザイン）
`;
}
