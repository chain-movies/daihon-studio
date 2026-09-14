#!/usr/bin/env node
/* 商品カレンダー操作
   node factory/calendar.mjs today            → 今日ビルドすべき pack id を出力（無ければ空）
   node factory/calendar.mjs next-design      → デザイン未実装（20個未満）の最も早い pack id（実装対象）
   node factory/calendar.mjs built <pack> <date> → built に記録
   node factory/calendar.mjs list             → 一覧 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'calendar.json');
const cal = JSON.parse(fs.readFileSync(file, 'utf8'));
const [cmd, a, b] = process.argv.slice(2);
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
if (cmd === 'today') {
  // 予定日が今日以前で未ビルドのものを古い順に1つ
  const item = cal.queue.filter((q) => q.date <= today && !q.built).sort((x, y) => x.date.localeCompare(y.date))[0];
  process.stdout.write(item ? item.pack : '');
} else if (cmd === 'next-design') {
  // designs.js にまだ20デザイン揃っていない、最も日付の早い pack（Codex/Claude の実装対象）
  const { createRequire } = await import('node:module');
  const d = createRequire(import.meta.url)(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'telop', 'designs.js'));
  const count = (pk) => d.DESIGNS.filter((x) => x.pack === pk).length;
  const item = cal.queue.filter((q) => !q.built && count(q.pack) < 20).sort((x, y) => x.date.localeCompare(y.date))[0];
  process.stdout.write(item ? item.pack : '');
} else if (cmd === 'built') {
  const item = cal.queue.find((q) => q.pack === a);
  if (item) { item.built = b || today; }
  fs.writeFileSync(file, JSON.stringify(cal, null, 2) + '\n');
} else {
  for (const q of cal.queue) console.log(`${q.date}  ${q.pack.padEnd(18)} ${q.built ? '✔ ' + q.built : '⏳'}  ${q.title || ''}`);
}
