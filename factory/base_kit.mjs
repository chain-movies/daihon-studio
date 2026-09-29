#!/usr/bin/env node
// BASE 出品キット生成
//   node factory/base_kit.mjs                 # 配信済み（built 済み）パック全部
//   node factory/base_kit.mjs --pack stream-vol1
//   node factory/base_kit.mjs --ref main      # 画像URLの参照ブランチ（既定 main）
// 出力: factory/base/items.csv（CSV商品管理 App 用）と factory/base/<pack>/{title,description,tags,images,price}.txt
// BASE には公開APIがあるが「デジタルコンテンツ販売 App」のZIP登録はAPI非対応のため、
// 商品情報は CSV で一括、ZIP だけ手で付ける前提。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { DESIGNS, PACKS } = require(path.join(root, 'telop/designs.js'));
const calendar = JSON.parse(fs.readFileSync(path.join(root, 'factory/calendar.json'), 'utf8'));
const links = JSON.parse(fs.readFileSync(path.join(root, 'shop/links.json'), 'utf8'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const onlyPack = opt('--pack', null);
const ref = opt('--ref', 'main');
const RAW = `https://raw.githubusercontent.com/chain-movies/daihon-studio/${ref}`;
const GALLERY = ['cover', 'designs', 'portrait', 'howto', 'contents', 'compare', 'faq'];

const items = calendar.queue;
const targets = items.filter((it) => (onlyPack ? it.pack === onlyPack : it.built) && PACKS[it.pack]);
if (!targets.length) { console.error('対象パックなし'); process.exit(1); }

const outRoot = path.join(root, 'factory/base');
fs.mkdirSync(outRoot, { recursive: true });

function plain(pack, designs, count) {
  const cats = [...new Set(designs.map((d) => d.category))];
  const names = designs.map((d, i) => `${String(i + 1).padStart(2, '0')}. ${d.name}（${(d.variants || []).map((v) => v.name).join('・')}）`).join('\n');
  return `${pack.name}｜${designs.length}デザイン×色違い ${count}点の透過PNG＋テロップメーカー付き

貼るだけでテレビ番組のような「あのテロップ」になる、${cats.join('・')} ${designs.length}デザインのセットです。
文字を変えたい人のために、ブラウザで動く「テロップメーカー」を同梱。台本を貼れば全行分を一括でPNG書き出しできます。

■ こんな人に
・YouTube / ショート動画のテロップに「テレビっぽさ」が欲しい
・Premiere Pro の文字装飾を毎回ゼロから作るのが面倒
・CapCut・DaVinci・iMovie でも使える素材が欲しい（画像を置くだけ）

■ 収録内容
・16:9（1920×1080）透過PNG ${designs.length}デザイン × 色違い（計 ${count}点）
・9:16（1080×1920）縦動画用 透過PNG（同数）
・文字なし「帯・ボックスのみ」PNG（自分のテキストを載せて使える）
・テロップメーカー（HTMLアプリ）: 好きな文字で同デザインを書き出し／台本一括書き出し
・RECIPE.txt: Premiere のエッセンシャルグラフィックスで再現するための設定値

■ 収録デザイン
${names}

■ 対応ソフト
Premiere Pro / After Effects / CapCut / DaVinci Resolve / Final Cut Pro / iMovie / Canva など、画像を読み込めるものすべて

■ ライセンス
商用利用OK・クレジット表記不要。
素材そのものの再配布・転売・二次配布、素材集としての再パッケージは禁止。
デジタル商品のため、購入後の返品・返金はできません。

■ 注意
特定の番組・局のロゴやデザインを複製したものではなく、ジャンルの「雰囲気」を再現した汎用デザインです。
テロップメーカーはフォント読み込みにインターネット接続が必要です。
ご購入後、ダウンロードできる ZIP（約 数十MB）を解凍してお使いください。

■ サポート
使い方のご質問は BASE のメッセージからどうぞ。
© Chain-Movies Inc.`;
}

const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const header = ['商品名', '説明', '価格', '税率', '在庫数', '公開状態', '表示順', ...GALLERY.map((_, i) => `商品画像${i + 1}`)];
const rows = [header.join(',')];
let order = 1;
for (const it of targets) {
  const pack = PACKS[it.pack];
  const designs = DESIGNS.filter((d) => d.pack === it.pack);
  const count = designs.reduce((a, d) => a + ((d.variants && d.variants.length) || 1), 0);
  const galleryDir = path.join(root, 'factory/gallery', it.pack);
  const images = GALLERY.map((g, i) => {
    const f = `${it.pack}_${String(i + 1).padStart(2, '0')}_${g}.jpg`;
    return fs.existsSync(path.join(galleryDir, f)) ? `${RAW}/factory/gallery/${it.pack}/${f}` : '';
  });
  const title = `${pack.name}｜${designs.length}デザイン×色違い ${count}点 透過PNG＋テロップメーカー付き`;
  const desc = plain(pack, designs, count);
  const tags = ['テロップ', 'テロップ素材', 'Premiere Pro', 'CapCut', '動画編集', '透過PNG', 'YouTube', pack.short.replace(/ Vol\.\d+$/, '')].join(', ');
  const dir = path.join(outRoot, it.pack);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'title.txt'), title + '\n');
  fs.writeFileSync(path.join(dir, 'description.txt'), desc + '\n');
  fs.writeFileSync(path.join(dir, 'tags.txt'), tags + '\n');
  fs.writeFileSync(path.join(dir, 'price.txt'), `${pack.price}\n`);
  fs.writeFileSync(path.join(dir, 'images.txt'), images.filter(Boolean).join('\n') + '\n');
  const rel = (links.packs[it.pack] && links.packs[it.pack].release) || '';
  fs.writeFileSync(path.join(dir, 'zip.txt'), `販売用ZIPの取得元（Release）: ${rel}\nAssets の「販売用ZIP（BASE/BOOTHにアップロード）」= ${it.pack}_${it.built || it.date}.zip\n`);
  rows.push([title, desc, pack.price, 10, 9999, it.built ? 1 : 0, order++, ...images].map(esc).join(','));
  console.log(`✔ ${it.pack}  ${images.filter(Boolean).length} 画像  ¥${pack.price}`);
}
fs.writeFileSync(path.join(outRoot, 'items.csv'), '﻿' + rows.join('\r\n') + '\r\n');
console.log(`→ ${path.relative(root, outRoot)}/items.csv（${rows.length - 1} 商品）`);
