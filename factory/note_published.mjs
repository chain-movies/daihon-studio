#!/usr/bin/env node
/* note の公開 URL を台帳と次の記事に反映する
   使い方:
     node factory/note_published.mjs 24 https://note.com/xxxx/n/nxxxxxxxx          # No.24 を公開済みにする
     node factory/note_published.mjs 24 <url> --dry                               # 書き込まずに何が変わるかだけ表示
   やること:
     1. content/note/<No.24 のフォルダ>/ledger.json → status「公開済み」・url・publishedAt を追加
     2. factory/note_ledger.md（無ければ作る）に 1 行追記（No／タイトル／公開日／URL）
     3. 次の No（25）の body.txt の冒頭に「前回の記事」リンクを差し込む（既にあれば置き換え）
   公開ボタンは人間が押す。これはその後の「記録」だけ */
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const [noArg, url] = args.filter((a) => !a.startsWith('--'));
if (!noArg || !url) { console.error('使い方: node factory/note_published.mjs <No> <公開URL> [--dry]'); process.exit(1); }
if (!/^https:\/\/note\.com\/[^/]+\/n\/[0-9a-z]+/.test(url)) console.log(`⚠ note の記事 URL の形ではない: ${url}（そのまま記録します）`);
const no = String(parseInt(noArg, 10));
const noteDir = path.join(root, 'content/note');
const dirs = fs.readdirSync(noteDir).filter((d) => fs.existsSync(path.join(noteDir, d, 'ledger.json')));
const load = (d) => ({ dir: d, ledger: JSON.parse(fs.readFileSync(path.join(noteDir, d, 'ledger.json'), 'utf8')) });
const all = dirs.map(load);
const cur = all.find((x) => String(parseInt(x.ledger.no, 10)) === no);
if (!cur) { console.error(`No.${no} の ledger.json が content/note/*/ に無い（ある No: ${all.map((x) => x.ledger.no).join(', ')}）`); process.exit(1); }
const next = all.find((x) => String(parseInt(x.ledger.no, 10)) === String(Number(no) + 1));
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// 1. ledger.json
const led = { ...cur.ledger, status: '公開済み', url, publishedAt: today };
console.log(`1. content/note/${cur.dir}/ledger.json → status「公開済み」 url=${url} publishedAt=${today}`);
// 2. note_ledger.md
const mdPath = path.join(root, 'factory/note_ledger.md');
const header = '# note 公開台帳（公開済みのみ・新しいものが下）\n\n| No | タイトル | 公開日 | URL |\n|---|---|---|---|\n';
let md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : header;
const row = `| ${no} | ${cur.ledger.title} | ${today} | ${url} |`;
const already = md.split('\n').some((l) => l.startsWith(`| ${no} |`));
md = already ? md.split('\n').map((l) => (l.startsWith(`| ${no} |`) ? row : l)).join('\n') : md.replace(/\s*$/, '\n') + row + '\n';
console.log(`2. factory/note_ledger.md に ${already ? '上書き' : '追記'}: ${row}`);
// 3. 次の記事の body.txt
let bodyMsg = '3. 次の記事なし（No.' + (Number(no) + 1) + ' の下書きが無い）';
let newBody = null, bodyPath = null;
if (next) {
  bodyPath = path.join(noteDir, next.dir, 'body.txt');
  if (fs.existsSync(bodyPath)) {
    const body = fs.readFileSync(bodyPath, 'utf8');
    const lines = body.split('\n');
    const mark = '前回の記事:';
    const link = `${mark} ${cur.ledger.title}\n${url}`;
    const i = lines.findIndex((l) => l.startsWith(mark));
    if (i >= 0) { lines.splice(i, 2, ...link.split('\n')); newBody = lines.join('\n'); bodyMsg = `3. content/note/${next.dir}/body.txt の「前回の記事」を置き換え`; }
    else { lines.splice(2, 0, link, ''); newBody = lines.join('\n'); bodyMsg = `3. content/note/${next.dir}/body.txt の冒頭（1 段落目の後）に「前回の記事」リンクを差し込み`; }
  } else bodyMsg = `3. content/note/${next.dir}/body.txt が無い`;
}
console.log(bodyMsg);
if (dry) { console.log('\n--dry: 書き込みなし'); process.exit(0); }
fs.writeFileSync(path.join(noteDir, cur.dir, 'ledger.json'), JSON.stringify(led, null, 0).replace(/^\{/, '{').replace(/,"/g, ', "').replace(/":/g, '": ') + '\n');
fs.writeFileSync(mdPath, md);
if (newBody) fs.writeFileSync(bodyPath, newBody);
console.log(`\n→ 反映しました。次: git で commit して push。Drive の Doc 本文（次の記事）も冒頭の 2 行を足すと揃います`);
