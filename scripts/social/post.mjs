#!/usr/bin/env node
/**
 * キューの中で予定時刻を過ぎた投稿を X / Threads へ送る。
 * 環境変数 DRY_RUN=1 で送信せずに内容だけ表示する。
 *
 * 使い方: node scripts/social/post.mjs [--dry-run] [--only <id>]
 */
import {
  loadConfig, loadQueue, loadHistory, saveQueue, saveHistory,
  parseScheduledAt, formatJST,
} from './lib/store.mjs';
import { validateText, lengthFor, LIMITS } from './lib/text.mjs';
import { postToX, postThreadToX, xCredsFromEnv } from './lib/x.mjs';
import { postToThreads, postThreadToThreads, threadsCredsFromEnv } from './lib/threads.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const onlyId = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const MAX_ATTEMPTS = 3;

const config = loadConfig();
const queue = loadQueue();
const history = loadHistory();

/** item.text を対象プラットフォーム向けの配列（連投対応）に正規化する */
function resolveTexts(item, platform) {
  const t = item.text;
  let v;
  if (typeof t === 'string') v = t;
  else if (Array.isArray(t)) v = t;
  else if (t && typeof t === 'object') v = t[platform] ?? t.all ?? t.default;
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).filter(s => typeof s === 'string' && s.trim() !== '');
}

const enabled = new Set(config.platforms || ['x', 'threads']);
const now = Date.now();
const staleMs = (config.staleAfterMinutes ?? 180) * 60000;

/* ---------- 対象の抽出 ---------- */
const due = [];
for (const item of queue.items) {
  if (onlyId && item.id !== onlyId) continue;
  if (!['scheduled', 'failed'].includes(item.status)) continue;
  if (item.approved === false) continue;

  const at = parseScheduledAt(item.scheduledAt);
  if (!at) {
    item.status = 'failed';
    item.lastError = 'scheduledAt を解釈できません（例: 2026-09-01T07:30）';
    continue;
  }
  if (!onlyId && at.getTime() > now) continue;

  if (!onlyId && now - at.getTime() > staleMs) {
    item.status = 'skipped';
    item.lastError = `予定時刻を ${Math.round((now - at.getTime()) / 60000)} 分過ぎたため送信しませんでした`;
    console.log(`⏭  ${item.id}: ${item.lastError}`);
    continue;
  }
  due.push(item);
}

const targets = due.slice(0, config.maxPostsPerRun ?? 2);

if (!targets.length) {
  console.log('送信対象はありません。');
  saveQueue(queue);
  process.exit(0);
}

/* ---------- 認証情報 ---------- */
const { creds: xCreds, missing: xMissing } = xCredsFromEnv();
const { creds: thCreds, missing: thMissing } = threadsCredsFromEnv();

const needX = targets.some(i => (i.platforms || config.platforms).includes('x') && enabled.has('x'));
const needTh = targets.some(i => (i.platforms || config.platforms).includes('threads') && enabled.has('threads'));

if (!DRY_RUN) {
  const problems = [];
  if (needX && xMissing.length) problems.push(`X の秘密情報が未設定: ${xMissing.join(', ')}`);
  if (needTh && thMissing.length) problems.push(`Threads の秘密情報が未設定: ${thMissing.join(', ')}`);
  if (problems.length) {
    console.error('✗ ' + problems.join('\n✗ '));
    console.error('  → GitHub の Settings → Secrets and variables → Actions で登録してください（docs/SOCIAL_AUTO_POST.md 参照）');
    process.exit(1);
  }
}

/* ---------- 送信 ---------- */
let failures = 0;

for (const item of targets) {
  const platforms = (item.platforms || config.platforms).filter(p => enabled.has(p));
  item.results = item.results || {};
  console.log(`\n▶ ${item.id}（予定 ${formatJST(parseScheduledAt(item.scheduledAt))}）`);

  let allOk = true;

  for (const platform of platforms) {
    if (item.results[platform]?.ok) {
      console.log(`  ✓ ${platform}: 送信済みのためスキップ`);
      continue;
    }

    const texts = resolveTexts(item, platform);
    if (!texts.length) {
      console.log(`  ⏭  ${platform}: 本文がないためスキップ`);
      continue;
    }

    const errors = texts.flatMap(t => validateText(platform, t));
    if (errors.length) {
      allOk = false;
      item.results[platform] = { ok: false, error: errors.join(' / '), at: new Date().toISOString() };
      console.error(`  ✗ ${platform}: ${errors.join(' / ')}`);
      continue;
    }

    const preview = texts.map(t => `[${lengthFor(platform, t)}/${LIMITS[platform]}] ${t.replace(/\n/g, ' ⏎ ')}`).join('\n      ');
    if (DRY_RUN) {
      console.log(`  ○ ${platform}(dry-run): ${preview}`);
      continue;
    }

    try {
      const res = platform === 'x'
        ? (texts.length > 1 ? await postThreadToX(texts, { creds: xCreds }) : [await postToX(texts[0], { creds: xCreds })])
        : (texts.length > 1 ? await postThreadToThreads(texts, { creds: thCreds }) : [await postToThreads(texts[0], { creds: thCreds })]);

      item.results[platform] = {
        ok: true,
        id: res[0].id,
        url: res[0].url,
        ids: res.map(r => r.id),
        at: new Date().toISOString(),
      };
      console.log(`  ✓ ${platform}: ${res[0].url}`);
    } catch (e) {
      allOk = false;
      failures++;
      item.results[platform] = {
        ok: false,
        error: e.message,
        retryable: !!e.retryable,
        at: new Date().toISOString(),
      };
      console.error(`  ✗ ${platform}: ${e.message}`);
    }
  }

  if (DRY_RUN) continue;

  item.attempts = (item.attempts || 0) + 1;

  if (allOk) {
    item.status = 'posted';
    item.postedAt = new Date().toISOString();
    delete item.lastError;
    history.items.push({
      id: item.id,
      factId: item.factId,
      factType: item.factType,
      postedAt: item.postedAt,
      scheduledAt: item.scheduledAt,
      platforms,
      text: item.text,
      results: item.results,
    });
  } else if (item.attempts >= MAX_ATTEMPTS) {
    item.status = 'failed';
    item.lastError = `${MAX_ATTEMPTS} 回試みて成功しませんでした。内容を直して status を scheduled に戻すと再試行します。`;
    console.error(`  ! ${item.id}: ${item.lastError}`);
  } else {
    item.status = 'failed';  // 次回の実行で再試行される
    item.lastError = `試行 ${item.attempts}/${MAX_ATTEMPTS}。次回の実行で未送信のぶんだけ再試行します。`;
  }
}

/* ---------- 保存 ---------- */
if (!DRY_RUN) {
  saveQueue(queue);
  saveHistory(history);
  console.log('\nキューと履歴を更新しました。');
} else {
  console.log('\n--dry-run のため送信も保存もしていません。');
}

process.exit(failures > 0 ? 1 : 0);
