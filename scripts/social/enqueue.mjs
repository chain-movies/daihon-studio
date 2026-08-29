#!/usr/bin/env node
/**
 * 単発の投稿をキューに追加する（GitHub Actions の手動実行や、手元からの予約に使う）。
 *
 * 例:
 *   node scripts/social/enqueue.mjs --text "本文" --at "2026-09-01T07:30" --platforms x,threads
 *   node scripts/social/enqueue.mjs --text "本文" --at now+30m --no-approve
 */
import { loadConfig, loadQueue, saveQueue, parseScheduledAt, formatJST, nowJST } from './lib/store.mjs';
import { lengthFor, LIMITS, validateText } from './lib/text.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const flag = name => args.includes(`--${name}`);

const text = opt('text') ?? process.env.POST_TEXT ?? '';
if (!text.trim()) {
  console.error('--text（または環境変数 POST_TEXT）に本文を指定してください。');
  process.exit(1);
}

const config = loadConfig();
const queue = loadQueue();

/** "now+30m" / "2026-09-01T07:30" / 空（=今すぐ）を JST の予定時刻に */
function resolveAt(raw) {
  const v = (raw || '').trim();
  if (!v || v === 'now') return jstStamp(new Date());
  const rel = v.match(/^now\+(\d+)([mh])$/i);
  if (rel) {
    const ms = Number(rel[1]) * (rel[2].toLowerCase() === 'h' ? 3600000 : 60000);
    return jstStamp(new Date(Date.now() + ms));
  }
  const parsed = parseScheduledAt(v);
  if (!parsed) {
    console.error(`--at を解釈できません: "${v}"（例: 2026-09-01T07:30 / now+30m / now）`);
    process.exit(1);
  }
  return v.length === 16 ? `${v}:00+09:00` : v;
}

function jstStamp(date) {
  return nowJST(date).toISOString().slice(0, 19) + '+09:00';
}

const scheduledAt = resolveAt(opt('at') ?? process.env.POST_AT);
const platforms = (opt('platforms') ?? process.env.POST_PLATFORMS ?? (config.platforms || []).join(','))
  .split(',').map(s => s.trim()).filter(Boolean);

const unknown = platforms.filter(p => !['x', 'threads'].includes(p));
if (unknown.length) {
  console.error(`未知の投稿先: ${unknown.join(', ')}（x / threads のみ）`);
  process.exit(1);
}
if (!platforms.length) {
  console.error('投稿先が空です。--platforms x,threads のように指定してください。');
  process.exit(1);
}

const approved = !flag('no-approve') && !/^(1|true|yes)$/i.test(process.env.POST_NO_APPROVE || '');

const errors = platforms.flatMap(p => validateText(p, text).map(e => `${p}: ${e}`));
if (errors.length) {
  console.error('本文が投稿先の制限を超えています:');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}

const id = opt('id') ?? `manual-${scheduledAt.slice(0, 10)}-${scheduledAt.slice(11, 16).replace(':', '')}-${Math.random().toString(36).slice(2, 6)}`;
if (queue.items.some(it => it.id === id)) {
  console.error(`id "${id}" は既にキューにあります。`);
  process.exit(1);
}

const item = {
  id,
  status: approved ? 'scheduled' : 'draft',
  approved,
  scheduledAt,
  platforms,
  source: 'manual',
  text: Object.fromEntries(platforms.map(p => [p, text])),
};

queue.items.push(item);
queue.items.sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1));
saveQueue(queue);

console.log(`キューに追加しました: ${id}`);
console.log(`  予定 : ${formatJST(parseScheduledAt(scheduledAt))}`);
console.log(`  投稿先: ${platforms.join(', ')}`);
console.log(`  承認 : ${approved ? 'あり（予定時刻に自動投稿されます）' : 'なし（approved を true にするまで投稿されません）'}`);
for (const p of platforms) console.log(`  [${p} ${lengthFor(p, text)}/${LIMITS[p]}]`);
