#!/usr/bin/env node
/* 使い方動画（60 秒・6 カット）のナレーションを SRT 字幕にする
   使い方:
     node factory/howto_srt.mjs                      # factory/bundle/howto-subtitles.srt（共通版）
     node factory/howto_srt.mjs --pack pet-vol2      # 最後のカットをそのパック名に差し替えて factory/howto/<pack>/subtitles.srt にも出す
     node factory/howto_srt.mjs --offset 1.5         # 収録の頭に 1.5 秒の間があるとき全体をずらす
   秒数は factory/bundle/howto-record-sheet.md のカット表（0–6／6–16／16–30／30–45／45–54／54–60）に合わせてある。
   Premiere（ファイル → 読み込み）・CapCut（テキスト → ローカル字幕）にそのまま読める。1 行は 20 字前後で折る */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { PACKS } = require(path.join(root, 'telop/designs.js'));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const pack = opt('--pack', null);
const offset = parseFloat(opt('--offset', '0')) || 0;
if (pack && !PACKS[pack]) { console.error(`pack が無い: ${pack}`); process.exit(1); }

// カット表（秒）とナレーション。1 カットが長いときは句点で 2 枚に割る
const CUTS = [
  { s: 0, e: 6, lines: ['テレビっぽいテロップ、貼るだけで作れます'] },
  { s: 6, e: 16, lines: ['買うと入っているのはこれ。', '横動画用と縦動画用の透過 PNG、文字なしの帯、', 'そして文字を変えられるテロップメーカー'] },
  { s: 16, e: 30, lines: ['使い方は画像を置くだけ。', 'Premiere でも CapCut でも iMovie でも同じです'] },
  { s: 30, e: 45, lines: ['文字を変えたいときはテロップメーカー。', '打ち替えて書き出すだけ。', '台本を貼れば全部まとめて出せます'] },
  { s: 45, e: 54, lines: ['ショート動画用の縦版も全デザインに入っています'] },
  { s: 54, e: 60, lines: [pack ? `${PACKS[pack].name}、1 パック 1,980 円。` : '1 パック 1,980 円、', '商用利用 OK・クレジット不要。リンクは説明欄に'] },
];
const ts = (sec) => { const t = Math.max(0, sec + offset); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`; };
// 1 カットの時間を行数で等分し、各行を 1 枚の字幕にする（1 枚 2 行まで: 20 字を超える行は読点で折る）
const wrap = (l) => (l.length > 22 ? l.replace(/(、|。)(?=.)/, '$1\n') : l);
const cues = []; let n = 1;
for (const c of CUTS) {
  const dur = (c.e - c.s) / c.lines.length;
  c.lines.forEach((l, i) => { const a = c.s + dur * i, b = c.s + dur * (i + 1) - 0.05; cues.push(`${n++}\n${ts(a)} --> ${ts(b)}\n${wrap(l)}\n`); });
}
const srt = cues.join('\n');
const outCommon = path.join(root, 'factory/bundle/howto-subtitles.srt');
if (!pack) { fs.writeFileSync(outCommon, srt); console.log(`→ ${path.relative(root, outCommon)}（${cues.length} 枚・60 秒・共通版）`); }
else { const dir = path.join(root, 'factory/howto', pack); fs.mkdirSync(dir, { recursive: true }); const out = path.join(dir, 'subtitles.srt'); fs.writeFileSync(out, srt); console.log(`→ ${path.relative(root, out)}（${cues.length} 枚・60 秒・最後のカットは「${PACKS[pack].name}」）`); }
