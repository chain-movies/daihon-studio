#!/usr/bin/env node
/* 「売る側の数字」を自動で数える（朝の報告の先頭に貼る）
   使い方:
     node factory/status.mjs          # 1 行ずつ表示
     node factory/status.mjs --md     # 報告にそのまま貼れる Markdown
     node factory/status.mjs --json   # 機械向け
   数えるもの: BASE 掲載数（shop/links.json の base）、Release 済みパック数（calendar の built）、CSV 商品数（factory/base/items.csv）、
   先行在庫（20 デザイン揃っていて未 Release）、note 公開数（content/note/<dir>/ledger.json）、使い方動画（factory/howto/raw/ のファイル数）、未実装テーマ数 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { DESIGNS, PACKS } = require(path.join(root, 'telop/designs.js'));
const cal = JSON.parse(fs.readFileSync(path.join(root, 'factory/calendar.json'), 'utf8'));
const links = JSON.parse(fs.readFileSync(path.join(root, 'shop/links.json'), 'utf8'));
const args = process.argv.slice(2);
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const cnt = (p) => DESIGNS.filter((d) => d.pack === p).length;

const released = cal.queue.filter((q) => q.built);
const onBase = Object.entries(links.packs).filter(([, v]) => v.base);
const csvPath = path.join(root, 'factory/base/items.csv');
const csvRows = fs.existsSync(csvPath) ? (fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '').match(/^"(?:[^"]|"")*",/gm) || []).length : 0;
const csvFiles = fs.existsSync(path.join(root, 'factory/base')) ? fs.readdirSync(path.join(root, 'factory/base')).filter((f) => /^items_\d+\.csv$/.test(f)).length : 0;
const stock = cal.queue.filter((q) => !q.built && cnt(q.pack) >= 20).sort((a, b) => a.date.localeCompare(b.date));
const todo = cal.queue.filter((q) => !q.built && cnt(q.pack) < 20).sort((a, b) => a.date.localeCompare(b.date));
const noteDir = path.join(root, 'content/note');
const ledgers = fs.existsSync(noteDir) ? fs.readdirSync(noteDir).map((d) => path.join(noteDir, d, 'ledger.json')).filter((f) => fs.existsSync(f)).map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))) : [];
const notePublished = ledgers.filter((l) => /公開済/.test(l.status || ''));
const noteWaiting = ledgers.filter((l) => !/公開済/.test(l.status || '')).map((l) => l.no).sort((a, b) => a - b);
const rawDir = path.join(root, 'factory/howto/raw');
const videos = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).filter((f) => /\.(mp4|mov|m4v|mkv)$/i.test(f)).length : 0;
const baseMissing = released.filter((q) => !(links.packs[q.pack] && links.packs[q.pack].base)).length;

const out = {
  date: today,
  base_listed: onBase.length, released: released.length, base_missing: baseMissing,
  csv_items: csvRows, csv_files: csvFiles,
  stock: stock.map((q) => ({ pack: q.pack, date: q.date })),
  todo: todo.length, todo_next: todo.slice(0, 3).map((q) => q.pack),
  note_published: notePublished.length, note_waiting: noteWaiting,
  videos, sales: null,
};
if (args.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
const lines = [
  `- BASE 掲載: ${out.base_listed} 商品（Release 済み ${out.released} パックのうち未登録 ${out.base_missing}）。CSV は ${out.csv_items} 商品分が items_01〜${String(out.csv_files).padStart(2, '0')}.csv に用意済み`,
  `- note 公開: ${out.note_published} 本（No.${out.note_waiting[0] ?? '—'}〜${out.note_waiting[out.note_waiting.length - 1] ?? '—'} の ${out.note_waiting.length} 本が下書き待ち）`,
  `- 使い方動画: ${out.videos} 本`,
  `- 売上: ${out.sales == null ? '0（BASE 管理画面で確認）' : out.sales}`,
  `- 先行在庫: ${out.stock.map((s) => `${s.pack.replace(/-vol1$/, '').replace(/-vol(\d)$/, '$1')}（${s.date.slice(5).replace('-', '/')}）`).join(' → ')}。未実装 ${out.todo} 件（次は ${out.todo_next.join('・')}）`,
];
if (args.includes('--md')) console.log('## 売る側の数字（先に）\n' + lines.join('\n'));
else console.log(lines.join('\n'));
