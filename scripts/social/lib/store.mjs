/* キュー・履歴・設定の読み書きと JST 時刻ユーティリティ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PATHS = {
  root: ROOT,
  config: path.join(ROOT, 'content/social/config.json'),
  queue: path.join(ROOT, 'content/social/queue.json'),
  history: path.join(ROOT, 'content/social/history.json'),
  facts: path.join(ROOT, 'content/social/facts.json'),
  templates: path.join(ROOT, 'content/social/templates.json'),
};

export function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`${path.relative(ROOT, file)} の読み込みに失敗: ${e.message}`);
  }
}

export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const loadConfig = () => readJSON(PATHS.config);
export const loadQueue = () => readJSON(PATHS.queue, { version: 1, items: [] });
export const loadHistory = () => readJSON(PATHS.history, { version: 1, items: [] });
export const saveQueue = q => writeJSON(PATHS.queue, q);
export const saveHistory = h => writeJSON(PATHS.history, h);

/* ---- JST 時刻 ---- */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 現在時刻の JST 表現（YYYY-MM-DDTHH:mm）*/
export function nowJST(now = new Date()) {
  return new Date(now.getTime() + JST_OFFSET_MS);
}

export function jstDateString(now = new Date()) {
  return nowJST(now).toISOString().slice(0, 10);
}

/** "2026-09-01T07:30" / "2026-09-01T07:30:00+09:00" を UTC の Date に */
export function parseScheduledAt(value) {
  if (!value) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const d = new Date(hasZone ? value : `${value.length === 16 ? value + ':00' : value}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatJST(date) {
  const d = nowJST(date);
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' JST';
}

/** 直近 n 日分の履歴（重複検査用） */
export function recentHistory(history, days) {
  const cutoff = Date.now() - days * 86400000;
  return history.items.filter(it => {
    const t = Date.parse(it.postedAt || '');
    return Number.isFinite(t) && t >= cutoff;
  });
}
