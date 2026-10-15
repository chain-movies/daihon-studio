/* Chain Cut 自動編集ツールの共通処理（ffmpeg / Playwright / zip / 静的サーバー） */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function args(argv = process.argv.slice(2)) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v != null && !v.startsWith('--')) { opt[k] = v; i++; } else opt[k] = true; }
    else pos.push(a);
  }
  return { pos, opt };
}

export function loadPlaywright() {
  const roots = [null, path.join(process.cwd(), 'node_modules') + '/', path.join(ROOT, 'node_modules') + '/', '/opt/node-tools/node_modules/', '/opt/node22/lib/node_modules/'];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8' }).trim() + '/'); } catch (e) { /* ignore */ }
  for (const r of roots) {
    try { return (r ? createRequire(r) : require)('playwright'); } catch (e) { /* next */ }
  }
  throw new Error('playwright が見つかりません。`npm i playwright@1.56.1 && npx playwright install chromium` を実行してください');
}
export async function launchBrowser() {
  const { chromium } = loadPlaywright();
  const o = { args: ['--autoplay-policy=no-user-gesture-required'] };
  if (process.env.HTTPS_PROXY) o.proxy = { server: process.env.HTTPS_PROXY, bypass: '<-loopback>,localhost,127.0.0.1' + (process.env.NO_PROXY ? ',' + process.env.NO_PROXY : '') };
  return chromium.launch(o);
}

/** リポジトリ直下を配信する簡易サーバー（crypto.subtle などのため localhost で開く） */
export function serveRepo() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}

export function sh(cmd, a, opts) {
  const r = spawnSync(cmd, a, Object.assign({ encoding: 'utf8', maxBuffer: 1 << 28 }, opts || {}));
  if (r.status !== 0) throw new Error(`${cmd} が失敗しました: ${(r.stderr || '').slice(-1500)}`);
  return r;
}

export function probe(file) {
  const r = sh('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  let w = v ? +v.width : 0, h = v ? +v.height : 0;
  const rot = v && ((v.side_data_list || []).find((x) => x.rotation != null) || {}).rotation;
  if (rot && Math.abs(rot) % 180 === 90) [w, h] = [h, w];
  const dur = +(j.format && j.format.duration) || +(v && v.duration) || +(a && a.duration) || 0;
  const ext = path.extname(file).toLowerCase();
  const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext);
  const type = isImage ? 'image' : v ? 'video' : a ? 'audio' : null;
  let fps = 30;
  if (v && v.avg_frame_rate && v.avg_frame_rate !== '0/0') { const [n, d] = v.avg_frame_rate.split('/').map(Number); if (d) fps = n / d; }
  return { type, duration: isImage ? null : dur, width: w, height: h, hasAudio: !!a && !isImage, fps, vcodec: v && v.codec_name, acodec: a && a.codec_name, size: fs.statSync(file).size };
}

export function mimeOf(file) {
  const ext = path.extname(file).toLowerCase().slice(1);
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[ext] || '';
}

/** ffmpeg silencedetect で無音区間を取る → [[start,end], ...]（素材の秒） */
export function detectSilence(file, thDb = -38, minSil = 0.45) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=noise=${thDb}dB:d=${minSil}`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = [];
  let s = null;
  for (const line of (r.stderr || '').split('\n')) {
    let m = line.match(/silence_start: (-?[\d.]+)/); if (m) s = Math.max(0, +m[1]);
    m = line.match(/silence_end: ([\d.]+)/); if (m && s != null) { out.push([s, +m[1]]); s = null; }
  }
  if (s != null) out.push([s, Infinity]);
  return out;
}

/** 無音区間から「残す区間」を作る（前後に pad 秒の余白） */
export function keepsFromSilence(silences, dur, pad = 0.08, minKeep = 0.15) {
  const keeps = [];
  let t = 0;
  for (const [a0, b0] of silences) {
    const a = a0 <= 0.01 ? 0 : a0 + pad, b = !isFinite(b0) || b0 >= dur - 0.01 ? dur : b0 - pad;
    if (b - a <= 0.05) continue;
    if (a - t > minKeep) keeps.push([t, a]);
    t = b;
  }
  if (dur - t > minKeep) keeps.push([t, dur]);
  return keeps.length ? keeps : [[0, dur]];
}

export function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const m = (r.stderr || '').match(/I:\s+(-?[\d.]+) LUFS/g);
  return m ? +m[m.length - 1].match(/-?[\d.]+/)[0] : null;
}

/** zip 作成（Python 標準の zipfile。無圧縮でまとめる） */
export function zipDir(dir, outZip) {
  fs.rmSync(outZip, { force: true });
  sh('python3', ['-c', `
import os, sys, zipfile
d, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED, allowZip64=True) as z:
    for root, _, files in os.walk(d):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, d))
`, dir, outZip]);
}
export function unzip(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  sh('python3', ['-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, dir]);
}

export const safeName = (n) => String(n).replace(/[\\/:*?"<>|]/g, '_');
export const uid = (p) => (p || 'c') + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const fmt = (t) => { const m = Math.floor(t / 60), s = (t % 60).toFixed(2).padStart(5, '0'); return `${m}:${s}`; };
