#!/usr/bin/env node
/* BASE の商品 URL を shop/links.json に一括で流し込む
   使い方（人間が貼ってきた URL をそのままファイルか標準入力に）:
     node factory/links_add.mjs --csv factory/base/items_01.csv < urls.txt   # URL だけ 10 行 → CSV の表示順どおりに割り当て
     node factory/links_add.mjs < lines.txt                                  # 「<packId or 商品名の一部> <URL>」の行なら CSV 不要
     node factory/links_add.mjs --dry ...                                    # 書き込まずに対応表だけ表示
     node factory/links_add.mjs --out /tmp/links.json ...                    # 別ファイルに書く（動作確認用）
   行の形:  https://chaincreate.base.shop/items/160094664
            pet-vol2 https://chaincreate.base.shop/items/160094665
            ペット Vol.2 https://chaincreate.base.shop/items/160094665
   終わったら `node factory/base_kit.mjs --missing` で未登録が減ったか確認できる */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { PACKS } = require(path.join(root, 'telop/designs.js'));
const linksPath = path.join(root, 'shop/links.json');
const links = JSON.parse(fs.readFileSync(linksPath, 'utf8'));
const calendar = JSON.parse(fs.readFileSync(path.join(root, 'factory/calendar.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dry = args.includes('--dry');
const csvPath = opt('--csv', null);
const outPath = opt('--out', linksPath);

// CSV の表示順 → pack（商品名の先頭 = PACKS[pack].name）
function csvOrder(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  // 1 列目（商品名）だけ取り出す。説明文に改行があるので「行頭の "」で判定
  const names = [];
  for (const m of txt.matchAll(/^"((?:[^"]|"")*)",/gm)) { const n = m[1].replace(/""/g, '"'); if (n !== '商品名') names.push(n); }
  return names.map((n) => nameToPack(n.split('｜')[0]));
}
const byName = Object.entries(PACKS).map(([id, p]) => ({ id, name: p.name, short: p.short }));
function nameToPack(s) {
  s = s.trim();
  if (PACKS[s]) return s;
  const exact = byName.find((p) => p.name === s); if (exact) return exact.id;
  const inc = byName.filter((p) => s && (p.name.includes(s) || s.includes(p.name) || p.short === s || (p.short && s.includes(p.short))));
  return inc.length === 1 ? inc[0].id : null;
}
const URL_RE = /https?:\/\/[^\s"'<>]+/;
const okBase = (u) => /^https:\/\/[a-z0-9-]+\.base\.(shop|ec)\/items\/\d+/.test(u) || /^https:\/\/(thebase\.in|base\.shop)\//.test(u);

const input = fs.readFileSync(0, 'utf8');
const lines = input.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && URL_RE.test(l));
if (!lines.length) { console.error('URL を含む行がありません（標準入力に貼ってください）'); process.exit(1); }
const order = csvPath ? csvOrder(csvPath) : [];
const rows = []; let plainIdx = 0;
for (const line of lines) {
  const url = line.match(URL_RE)[0];
  const label = line.replace(url, '').replace(/[\s,、:：→=-]+$/g, '').trim();
  let pack = null, how = '';
  if (label) { pack = nameToPack(label); how = pack ? `名前「${label}」` : `名前「${label}」が一意に決まらない`; }
  else if (order.length) { pack = order[plainIdx] || null; how = pack ? `CSV ${plainIdx + 1} 行目` : `CSV に ${plainIdx + 1} 行目がない`; plainIdx++; }
  else { how = 'pack 名も CSV も無い（--csv を付けるか、行頭に pack 名を）'; }
  rows.push({ url, pack, how, ok: okBase(url) });
}
let changed = 0;
for (const r of rows) {
  if (!r.pack) continue;
  const cal = calendar.queue.find((q) => q.pack === r.pack);
  if (!links.packs[r.pack]) links.packs[r.pack] = { base: '', release: cal && cal.built ? `https://github.com/chain-movies/daihon-studio/releases/tag/product-${r.pack}-${cal.built}` : '' };
  if (links.packs[r.pack].base !== r.url) { links.packs[r.pack].base = r.url; changed++; r.how += ' → 更新'; } else r.how += '（同じ URL・変更なし）';
}
console.log(rows.map((r) => `${r.pack ? '✔' : '✘'} ${(r.pack || '?').padEnd(18)} ${r.url}${r.ok ? '' : '  ⚠ BASE の商品 URL の形ではない'}  … ${r.how}`).join('\n'));
const bad = rows.filter((r) => !r.pack);
if (bad.length) console.log(`\n未対応 ${bad.length} 件: 行頭に pack 名（例: pet-vol2）を付けて再実行してください`);
if (dry) { console.log(`\n--dry: 書き込みなし（更新予定 ${changed} 件）`); process.exit(0); }
fs.writeFileSync(outPath, JSON.stringify(links, null, 2) + '\n');
const total = Object.values(links.packs).filter((p) => p.base).length;
console.log(`\n→ ${path.relative(root, outPath)} に ${changed} 件反映（BASE 登録済み ${total} パック）。次: node factory/base_kit.mjs --missing`);
