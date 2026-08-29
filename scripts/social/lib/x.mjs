/* X (Twitter) API v2 — POST /2/tweets（OAuth 1.0a ユーザーコンテキスト） */
import { buildAuthHeader } from './oauth1.mjs';

// テスト時のみ X_API_BASE で差し替える（本番は未設定）
const BASE = process.env.X_API_BASE || 'https://api.x.com';
const ENDPOINT = `${BASE}/2/tweets`;

export function xCredsFromEnv(env = process.env) {
  const creds = {
    consumerKey: env.X_API_KEY,
    consumerSecret: env.X_API_SECRET,
    accessToken: env.X_ACCESS_TOKEN,
    accessSecret: env.X_ACCESS_TOKEN_SECRET,
  };
  const missing = Object.entries(creds).filter(([, v]) => !v).map(([k]) => k);
  return { creds, missing };
}

/**
 * @param {string} text
 * @param {object} opts { creds, replyTo?: string }
 * @returns {Promise<{id:string, url:string}>}
 */
export async function postToX(text, { creds, replyTo } = {}) {
  const body = { text };
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };

  // JSON ボディは OAuth 署名の対象外（oauth_* のみを署名する）
  const authorization = buildAuthHeader({ method: 'POST', url: ENDPOINT, creds });

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { /* エラーページ等 */ }

  if (!res.ok) {
    const detail = json?.detail || json?.title || raw.slice(0, 300);
    const err = new Error(`X API ${res.status}: ${detail}`);
    err.status = res.status;
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }

  const id = json?.data?.id;
  if (!id) throw new Error(`X API: 応答に tweet id がありません — ${raw.slice(0, 300)}`);
  return { id, url: `https://x.com/i/web/status/${id}` };
}

/** スレッド（連投）。先頭から順に in_reply_to で繋ぐ */
export async function postThreadToX(texts, { creds } = {}) {
  const results = [];
  let replyTo;
  for (const t of texts) {
    const r = await postToX(t, { creds, replyTo });
    results.push(r);
    replyTo = r.id;
  }
  return results;
}
