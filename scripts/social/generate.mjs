#!/usr/bin/env node
/**
 * 事実バンク（facts.json）と型（templates.json）から投稿の下書きを作り、キューへ差し込む。
 * AI は使わない — 本人が書いた事実の組み合わせだけなので、生成物が事実と食い違うことがない。
 *
 * 使い方: node scripts/social/generate.mjs [--days 3] [--dry-run]
 */
import {
  PATHS, readJSON, loadConfig, loadQueue, loadHistory, saveQueue,
  parseScheduledAt, jstDateString, formatJST, recentHistory,
} from './lib/store.mjs';
import { fitTo, lengthFor, LIMITS } from './lib/text.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const config = loadConfig();
const facts = readJSON(PATHS.facts).items;
const templates = readJSON(PATHS.templates).types;
const queue = loadQueue();
const history = loadHistory();

const daysAhead = Number(opt('days', config.generateDaysAhead ?? 3));
const dryRun = flag('dry-run');

/* ---------- 重複を避けるための使用済み集合 ---------- */
const usedRecently = new Set([
  ...recentHistory(history, config.dedupeWindowDays ?? 10).map(h => h.factId),
  ...queue.items.filter(it => it.status !== 'posted').map(it => it.factId),
].filter(Boolean));

/** 最後に使われた順（古いものほど優先して再利用） */
const lastUsedAt = new Map();
for (const h of history.items) {
  if (!h.factId) continue;
  const t = Date.parse(h.postedAt || '') || 0;
  if (t > (lastUsedAt.get(h.factId) ?? 0)) lastUsedAt.set(h.factId, t);
}

function pickFact(avoidType) {
  const fresh = facts.filter(f => !usedRecently.has(f.id));
  let pool = fresh.length ? fresh : [...facts].sort(
    (a, b) => (lastUsedAt.get(a.id) ?? 0) - (lastUsedAt.get(b.id) ?? 0));

  // 直前と同じ型が続かないようにする（候補が尽きたら妥協する）
  const varied = pool.filter(f => f.type !== avoidType);
  if (varied.length) pool = varied;

  const chosen = pool[0];
  usedRecently.add(chosen.id);
  return chosen;
}

/* ---------- 本文の組み立て ---------- */
function render(tpl, fact) {
  return tpl
    .replace(/\{hook\}/g, fact.hook ?? '')
    .replace(/\{detail\}/g, fact.detail ?? '')
    .replace(/\{lesson\}/g, fact.lesson ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ctaBlock(platform) {
  const cta = config.cta || {};
  const parts = [];
  if (cta.text) parts.push(cta.text);
  // X は URL を含む投稿の単価が $0.015 → $0.200 と13倍になるため、
  // 既定では URL を付ける媒体を urlPlatforms で絞る（Threads は無料）
  const urlAllowed = cta.urlPlatforms ? cta.urlPlatforms.includes(platform) : true;
  if (cta.url && urlAllowed) parts.push(cta.url);
  if (!parts.length) return '';
  const tags = (config.hashtags?.[platform] || []).join(' ');
  return '\n\n' + parts.join('\n') + (tags ? `\n${tags}` : '');
}

function buildText(platform, fact, variantIndex, withCta) {
  const type = templates[fact.type];
  if (!type) throw new Error(`templates.json に型 "${fact.type}" がありません（fact: ${fact.id}）`);
  const variants = type[platform];
  if (!variants?.length) throw new Error(`型 "${fact.type}" に ${platform} 用テンプレートがありません`);

  const base = render(variants[variantIndex % variants.length], fact);
  const withTail = withCta ? base + ctaBlock(platform) : base;
  return fitTo(platform, withTail);
}

/* ---------- 予定スロットの列挙 ---------- */
function upcomingSlots() {
  const slots = config.dailySlots || [];
  const platforms = config.platforms || ['x', 'threads'];
  const now = Date.now();
  const out = [];

  for (let d = 0; d < daysAhead; d++) {
    const date = jstDateString(new Date(now + d * 86400000));
    for (const hhmm of slots) {
      const scheduledAt = `${date}T${hhmm}:00+09:00`;
      const at = parseScheduledAt(scheduledAt);
      if (!at || at.getTime() <= now) continue;           // 過ぎた枠は作らない
      if (queue.items.some(it => it.scheduledAt === scheduledAt)) continue; // 既に埋まっている
      out.push({ scheduledAt, at, platforms });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/* ---------- 生成 ---------- */
const slots = upcomingSlots();
if (!slots.length) {
  console.log('埋めるべき空きスロットはありません。');
  process.exit(0);
}

const everyNth = config.cta?.everyNthPost || 0;
let seq = history.items.length + queue.items.length;
let lastType = queue.items.at(-1)?.factType;
const created = [];

for (const slot of slots) {
  const fact = pickFact(lastType);
  lastType = fact.type;
  const withCta = everyNth > 0 && seq % everyNth === 0;
  const variantIndex = seq;

  const item = {
    id: `${slot.scheduledAt.slice(0, 10)}-${slot.scheduledAt.slice(11, 16).replace(':', '')}-${fact.id}`,
    status: config.autoApproveGenerated ? 'scheduled' : 'draft',
    approved: !!config.autoApproveGenerated,
    scheduledAt: slot.scheduledAt,
    platforms: slot.platforms,
    factId: fact.id,
    factType: fact.type,
    source: 'generate',
    text: {},
  };

  for (const p of slot.platforms) {
    item.text[p] = buildText(p, fact, variantIndex, withCta);
  }

  created.push(item);
  queue.items.push(item);
  seq++;
}

queue.items.sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1));

console.log(`下書きを ${created.length} 件つくりました（${config.autoApproveGenerated ? '自動承認' : '要承認: approved を true にすると投稿されます'}）`);
for (const it of created) {
  console.log(`\n── ${formatJST(parseScheduledAt(it.scheduledAt))} / ${it.factId} / ${templates[it.factType].label}`);
  for (const [p, t] of Object.entries(it.text)) {
    console.log(`  [${p} ${lengthFor(p, t)}/${LIMITS[p]}] ${t.replace(/\n/g, ' ⏎ ')}`);
  }
}

if (dryRun) {
  console.log('\n--dry-run のためキューには保存していません。');
} else {
  saveQueue(queue);
  console.log(`\ncontent/social/queue.json を更新しました（合計 ${queue.items.length} 件）`);
}
