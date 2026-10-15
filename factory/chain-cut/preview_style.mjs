#!/usr/bin/env node
/* スタイル（styles/*.json）のテロップを、参考フレームの上に描いて並べる（トレースの答え合わせ用）
 *
 *   node factory/chain-cut/preview_style.mjs styles/xxx.json --frame work/ref/frames/03_12.40s.jpg [--text "テロップの文字"] [--out cmp.png]
 *
 * 左：参考フレーム ／ 右：同じフレームにスタイルのテロップを描いたもの。designs が複数あれば縦に並ぶ。
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, launchBrowser, serveRepo, probe } from './lib.mjs';

const { pos, opt } = args();
if (!pos[0]) { console.error('使い方: node factory/chain-cut/preview_style.mjs styles/xxx.json --frame ref.jpg'); process.exit(1); }
const style = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
const frame = opt.frame ? path.resolve(opt.frame) : null;
let W = 1920, H = 1080;
if (frame) { const p = probe(frame); if (p.width) { const k = 1920 / Math.max(p.width, p.height); W = Math.round(p.width * k); H = Math.round(p.height * k); } }
else if (style.aspect === '9:16') { W = 1080; H = 1920; }
const out = path.resolve(opt.out || pos[0].replace(/\.json$/, '') + '_preview.png');
const bg = frame ? 'data:image/jpeg;base64,' + fs.readFileSync(frame).toString('base64') : null;

const srv = await serveRepo();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(srv.url + '/telop/render.html');
  await page.waitForFunction(() => window.TelopRenderer && window.TelopDesigns);
  const png = await page.evaluate(async ({ style, W, H, bg, text }) => {
    const R = window.TelopRenderer;
    const designs = (style.designs || []).concat((style.telop && style.telop.design && !(style.designs || []).some((d) => d.id === style.telop.design)) ? [window.TelopDesigns.DESIGNS.find((d) => d.id === style.telop.design)].filter(Boolean) : []);
    const img = bg ? await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = bg; }) : null;
    const rowH = Math.round(H / 2), rowW = Math.round(W / 2);
    const out = document.createElement('canvas');
    out.width = rowW * 2 + 30; out.height = (rowH + 40) * Math.max(1, designs.length) + 10;
    const g = out.getContext('2d');
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, out.width, out.height);
    const tc = document.createElement('canvas');
    for (let i = 0; i < designs.length; i++) {
      const d = designs[i];
      const spec = R.resolve(d, 0);
      const t = text || d.sample || 'テロップのサンプル';
      await R.ensureFonts(spec, [t, d.sampleSub || '']);
      R.render(tc, d, { width: W, height: H, variant: 0, text: t, sub: d.sampleSub || '', scale: (style.telop && style.telop.scale || 100) / 100 });
      const y = 10 + i * (rowH + 40);
      g.fillStyle = '#ddd'; g.font = '600 18px sans-serif';
      g.fillText(`${d.id}  ${d.name || ''}`, 10, y + 18);
      for (let k = 0; k < 2; k++) {
        const x = 10 + k * (rowW + 10);
        if (img) g.drawImage(img, x, y + 28, rowW, rowH); else { g.fillStyle = '#555'; g.fillRect(x, y + 28, rowW, rowH); }
        if (k === 1) g.drawImage(tc, 0, (style.telop && style.telop.y) || 0, W, H, x, y + 28, rowW, rowH);
      }
    }
    return out.toDataURL('image/png');
  }, { style, W, H, bg, text: opt.text || null });
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`✔ ${out}（左：参考 ／ 右：トレースしたテロップ）`);
} finally { await browser.close(); srv.close(); }
