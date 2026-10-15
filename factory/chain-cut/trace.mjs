#!/usr/bin/env node
/* 参考動画（またはスクショ）を分析して、演出をトレースするための材料を作る
 *
 *   node factory/chain-cut/trace.mjs 参考.mp4 --out work/ref [--max 24]
 *   node factory/chain-cut/trace.mjs スクショのフォルダ/ --out work/ref
 *   node factory/chain-cut/trace.mjs 参考.mp4 --out work/ref --burst 12.5   # 12.5秒から1秒ぶんを全コマ（アニメの動き確認用）
 *
 * 出力:
 *   report.json / report.md … 尺・カット数・平均ショット長・1分あたりのカット数・明るさ/彩度・ラウドネス・無音率
 *   frames/*.jpg            … ショットごとの代表フレーム（Claude が見てテロップや色味を読み取る）
 *   sheet_*.jpg             … 一覧（コンタクトシート）
 * ※ YouTube / TikTok などからの自動ダウンロードはしない（各サービスの規約のため）。画面録画やスクショを渡すこと。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { args, probe, sh, loudness, detectSilence, fmt } from './lib.mjs';

const { pos, opt } = args();
if (!pos[0]) { console.error('使い方: node factory/chain-cut/trace.mjs 参考動画.mp4 --out work/ref'); process.exit(1); }
const input = path.resolve(pos[0]);
const out = path.resolve(opt.out || 'work/ref');
fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
const maxFrames = +(opt.max || 24);

if (opt.burst != null) {
  // アニメーション確認用：指定秒から 1 秒ぶん（30コマ）を書き出す
  const t = +opt.burst, d = +(opt.len || 1);
  const dir = path.join(out, `burst_${t.toFixed(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  sh('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', input, '-t', String(d), '-vf', 'fps=30,scale=360:-2', path.join(dir, 'f_%03d.jpg')]);
  sh('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', input, '-t', String(d), '-vf', 'fps=15,scale=240:-2,tile=5x3', '-frames:v', '1', path.join(dir, 'burst_sheet.jpg')]);
  console.log(`✔ ${dir}（1/30秒ごと・burst_sheet.jpg は 1/15 秒ごとの一覧）`);
  process.exit(0);
}

const report = { source: path.basename(input), createdAt: new Date().toISOString() };
if (fs.statSync(input).isDirectory()) {
  // スクショ集
  const imgs = fs.readdirSync(input).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
  imgs.forEach((f, i) => sh('ffmpeg', ['-y', '-v', 'error', '-i', path.join(input, f), '-vf', 'scale=720:-2', path.join(out, 'frames', `${String(i + 1).padStart(2, '0')}_${f.replace(/\.\w+$/, '')}.jpg`)]));
  report.kind = 'images'; report.frames = imgs;
} else {
  const info = probe(input);
  Object.assign(report, { kind: 'video', duration: info.duration, width: info.width, height: info.height, fps: +info.fps.toFixed(2), aspect: info.width > info.height ? '16:9' : info.width < info.height ? '9:16' : '1:1' });
  // カット検出
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-an', '-vf', `select='gt(scene,${opt.scene || 0.32})',showinfo`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const cuts = [...(r.stderr || '').matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]).filter((t) => t > 0.2);
  const bounds = [0, ...cuts, info.duration];
  const shots = [];
  for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] - bounds[i] > 0.05) shots.push([bounds[i], bounds[i + 1]]);
  const lens = shots.map(([a, b]) => b - a).sort((a, b) => a - b);
  report.cuts = cuts.length;
  report.shots = shots.length;
  report.avgShot = +(info.duration / Math.max(1, shots.length)).toFixed(2);
  report.medianShot = +(lens[Math.floor(lens.length / 2)] || info.duration).toFixed(2);
  report.cutsPerMinute = +(cuts.length / (info.duration / 60)).toFixed(1);
  report.shotList = shots.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]);
  // 代表フレーム（ショットの真ん中。多すぎるときは間引く）
  let picks = shots.map(([a, b]) => (a + b) / 2);
  if (picks.length > maxFrames) { const k = picks.length / maxFrames; picks = Array.from({ length: maxFrames }, (_, i) => picks[Math.floor(i * k)]); }
  if (picks.length < Math.min(8, maxFrames)) { const n = Math.min(8, maxFrames); picks = Array.from({ length: n }, (_, i) => (i + 0.5) * info.duration / n); }
  report.frames = [];
  picks.forEach((t, i) => {
    const f = `${String(i + 1).padStart(2, '0')}_${t.toFixed(2)}s.jpg`;
    sh('ffmpeg', ['-y', '-v', 'error', '-ss', t.toFixed(3), '-i', input, '-frames:v', '1', '-vf', 'scale=720:-2', path.join(out, 'frames', f)]);
    report.frames.push({ file: 'frames/' + f, t: +t.toFixed(2) });
  });
  // 色（平均の明るさ・彩度）
  const st = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-an', '-vf', 'fps=2,scale=320:-2,signalstats,metadata=print', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const avg = (k) => { const v = [...(st.stderr || '').matchAll(new RegExp(`lavfi.signalstats.${k}=([\\d.]+)`, 'g'))].map((m) => +m[1]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const y = avg('YAVG'), sat = avg('SATAVG');
  report.color = { brightness: y && +(y / 255 * 100).toFixed(1), saturation: sat && +sat.toFixed(1), note: '明るさ%（50前後が普通）、彩度（30前後が普通・45以上は鮮やか）' };
  // 音
  if (info.hasAudio) {
    report.audio = { lufs: loudness(input) };
    const sil = detectSilence(input, -40, 0.3);
    const silent = sil.reduce((s, [a, b]) => s + (Math.min(b, info.duration) - a), 0);
    report.audio.silenceRatio = +(silent / info.duration).toFixed(3);
    report.audio.note = '無音率が低い＝BGMが常に鳴っている／間を詰めている。LUFS は -14 前後が SNS の標準';
  }
}

// コンタクトシート
const frames = fs.readdirSync(path.join(out, 'frames')).filter((f) => f.endsWith('.jpg')).sort();
const per = 12;
for (let i = 0; i < frames.length; i += per) {
  const list = path.join(out, `list_${i}.txt`);
  fs.writeFileSync(list, frames.slice(i, i + per).map((f) => `file '${path.join(out, 'frames', f).replace(/'/g, "'\\''")}'`).join('\n'));
  const vertical = report.aspect === '9:16';
  const cols = vertical ? 6 : 4;
  sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=${vertical ? 240 : 360}:-2,pad=iw+8:ih+8:4:4:black,tile=${cols}x${Math.ceil(Math.min(per, frames.length - i) / cols)}`, '-frames:v', '1', path.join(out, `sheet_${i / per + 1}.jpg`)]);
  fs.rmSync(list);
}

fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
const md = [`# 参考動画の分析：${report.source}`, ''];
if (report.kind === 'video') {
  md.push(`- 尺 ${fmt(report.duration)} ・ ${report.width}×${report.height}（${report.aspect}）・ ${report.fps}fps`);
  md.push(`- カット ${report.cuts} 回 ・ 平均ショット ${report.avgShot} 秒（中央値 ${report.medianShot} 秒）・ 1分あたり ${report.cutsPerMinute} カット`);
  if (report.color) md.push(`- 明るさ ${report.color.brightness}% ・ 彩度 ${report.color.saturation}`);
  if (report.audio) md.push(`- ラウドネス ${report.audio.lufs} LUFS ・ 無音率 ${(report.audio.silenceRatio * 100).toFixed(1)}%`);
}
md.push('', '## 次にやること（Claude 向け）', '',
  '1. sheet_*.jpg と frames/*.jpg を見て、テロップの「位置・大きさ・文字色・縁取り（太さ/色/重ね数）・帯や座布団・影・フォントの太さ/丸さ」を読み取る',
  '2. 気になるテロップの出現時刻で `--burst 秒` を実行し、登場アニメ（ポップ/スライド/ワイプ/タイプ）を確認する',
  '3. styles/<名前>.json を書く（designs にテロップの spec、telop/cut/look/bgm に演出ルール）。spec の書き方は telop/designs.js の既存デザインが手本',
  '4. `node factory/chain-cut/preview_style.mjs styles/<名前>.json --frame frames/xx.jpg` で参考フレームと並べて見比べ、近づくまで直す',
  '5. 実在の番組ロゴ・局名・人物の写真など固有のものは写さない（「〜風」の雰囲気までにとどめる）');
fs.writeFileSync(path.join(out, 'report.md'), md.join('\n') + '\n');
console.log(md.slice(0, 6).join('\n'));
console.log(`✔ ${out}（フレーム ${frames.length} 枚・シート ${Math.ceil(frames.length / per)} 枚）`);
