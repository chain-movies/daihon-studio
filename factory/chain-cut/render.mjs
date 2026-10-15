#!/usr/bin/env node
/* Chain Cut プロジェクト（.chaincut.zip かプロジェクトフォルダ）→ 完成 MP4（H.264 / AAC）
 *
 *   node factory/chain-cut/render.mjs work/out/xxx.chaincut.zip --out work/out/xxx.mp4 [--res 1] [--mbps 16] [--keep]
 *
 * Chain Cut 本体をヘッドレスのブラウザで開いて書き出すので、見た目はアプリと完全に同じになる。
 * ・ブラウザが H.264 を読めない環境でも動くよう、素材を一時的に「全フレームがキーフレームの VP8」に変換してから読み込む
 *   （シークが速くなり、書き出しも速くなる）。最後に ffmpeg で H.264 / AAC の MP4 に変換する。
 * ・製品版テロップを透かしなしで出すには環境変数 CHAIN_CUT_CODE に解除コードを入れる。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { args, launchBrowser, serveRepo, sh, unzip, zipDir, safeName, fmt } from './lib.mjs';

export async function render(input, o = {}) {
  const t0 = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chaincut-render-'));
  const src = path.join(tmp, 'src');
  if (fs.statSync(input).isDirectory()) fs.cpSync(input, src, { recursive: true }); else unzip(input, src);
  const pj = JSON.parse(fs.readFileSync(path.join(src, 'project.json'), 'utf8'));
  const outFile = path.resolve(o.out || path.join(path.dirname(path.resolve(input)), safeName(pj.name || 'chain-cut') + '.mp4'));
  const maxLong = Math.max(pj.width, pj.height);

  // ---- 1. 書き出し用プロキシ ----
  console.log('素材を書き出し用に変換中…');
  for (const m of pj.media) {
    const f = path.join(src, 'media', `${m.id}__${safeName(m.name)}`);
    if (!fs.existsSync(f)) { console.warn(`⚠ 素材なし: ${m.name}`); continue; }
    const tmpOut = f + '.proxy';
    if (m.type === 'video') {
      // 長辺を書き出しサイズに合わせ、全フレームをキーフレームに（シークが速い）
      const scale = `scale='if(gt(iw,ih),min(${maxLong},iw),-2)':'if(gt(iw,ih),-2,min(${maxLong},ih))'`;
      sh('ffmpeg', ['-y', '-v', 'error', '-i', f, '-vf', scale + ',format=yuv420p', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-g', '1', '-b:v', '25M', '-qmin', '2', '-qmax', '20',
        ...(m.hasAudio ? ['-c:a', 'libopus', '-b:a', '192k', '-ac', '2', '-ar', '48000'] : ['-an']), '-f', 'webm', tmpOut]);
      m.mime = 'video/webm';
    } else if (m.type === 'audio' && !/\.wav$/i.test(m.name)) {
      sh('ffmpeg', ['-y', '-v', 'error', '-i', f, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-f', 'wav', tmpOut]);
      m.mime = 'audio/wav';
    } else continue;
    fs.renameSync(tmpOut, f);
    m.size = fs.statSync(f).size;
  }
  fs.writeFileSync(path.join(src, 'project.json'), JSON.stringify(pj));
  const proxyZip = path.join(tmp, 'proxy.chaincut.zip');
  zipDir(src, proxyZip);

  // ---- 2. Chain Cut で書き出し ----
  const srv = await serveRepo();
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(srv.url + '/apps/chain-cut/');
    await page.waitForFunction(() => window.ChainCut && document.querySelector('#lic-badge').textContent.length > 0);
    const code = o.code || process.env.CHAIN_CUT_CODE;
    if (code) { const ok = await page.evaluate((c) => window.ChainCut.unlockWithCode(c), code); console.log(ok ? '製品版テロップ：解除済み' : '⚠ 解除コードが違います（製品版テロップには透かしが入ります）'); }
    await page.evaluate(() => { window.__ccFastSeek = true; });
    await page.setInputFiles('#file-proj', proxyZip);
    await page.waitForFunction((n) => window.ChainCut.media.size >= n && [...window.ChainCut.media.values()].every((r) => !r.busy), pj.media.length, { timeout: 600000 });
    const info = await page.evaluate(() => ({ clips: window.ChainCut.project.clips.length, locked: window.ChainCut.project.clips.filter((c) => c.type === 'telop' && window.ChainCut.isLocked(c.designId)).length }));
    if (info.locked) console.warn(`⚠ 製品版テロップ ${info.locked} 個に透かしが入ります（CHAIN_CUT_CODE を設定すると外れます）`);
    console.log(`書き出し中…（クリップ ${info.clips}）`);
    const dl = page.waitForEvent('download', { timeout: 0 });
    let last = '';
    const timer = setInterval(async () => { try { const s = await page.$eval('#x-info', (e) => e.textContent); if (s && s !== last) { last = s; process.stdout.write(`\r  ${s}        `); } } catch (e) { /* ignore */ } }, 2000);
    const res = await page.evaluate((x) => window.ChainCut.runExport(x).then(() => window.__lastExport), { name: 'render', k: +(o.res || 1), mbps: +(o.mbps || 16), range: o.range || 'all' });
    clearInterval(timer); process.stdout.write('\n');
    if (!res || res.error) throw new Error('書き出しに失敗: ' + (res && res.error) + (errs.length ? '\n' + errs.join('\n') : ''));
    const raw = path.join(tmp, 'raw.mp4');
    await (await dl).saveAs(raw);

    // ---- 3. H.264 / AAC に ----
    console.log('H.264 に変換中…');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    sh('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-c:v', 'libx264', '-preset', o.preset || 'medium', '-crf', String(o.crf || 18), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outFile]);
  } finally {
    await browser.close(); srv.close();
    if (!o.keep) fs.rmSync(tmp, { recursive: true, force: true });
  }
  const mb = (fs.statSync(outFile).size / 1048576).toFixed(1);
  console.log(`✔ ${outFile}（${Math.round(pj.width * (+(o.res || 1)) / 2) * 2}×${Math.round(pj.height * (+(o.res || 1)) / 2) * 2}・${mb} MB・${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
  return outFile;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pos, opt } = args();
  if (!pos[0]) { console.error('使い方: node factory/chain-cut/render.mjs project.chaincut.zip --out final.mp4'); process.exit(1); }
  render(pos[0], opt).catch((e) => { console.error('✖ ' + e.message); process.exit(1); });
}
export { fmt };
