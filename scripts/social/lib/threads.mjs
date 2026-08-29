/* Threads Graph API — コンテナ作成 → 公開の 2 段階 */
// テスト時のみ THREADS_API_BASE で差し替える（本番は未設定）
const BASE = `${process.env.THREADS_API_BASE || 'https://graph.threads.net'}/v1.0`;

export function threadsCredsFromEnv(env = process.env) {
  const creds = {
    userId: env.THREADS_USER_ID,
    accessToken: env.THREADS_ACCESS_TOKEN,
  };
  const missing = Object.entries(creds).filter(([, v]) => !v).map(([k]) => k);
  return { creds, missing };
}

async function call(path, params, { method = 'POST' } = {}) {
  const url = new URL(`${BASE}/${path}`);
  const form = new URLSearchParams(params);
  const res = method === 'GET'
    ? await fetch(`${url}?${form}`)
    : await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
      });

  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { /* noop */ }

  if (!res.ok || json?.error) {
    const msg = json?.error?.message || raw.slice(0, 300);
    // code 190 / OAuthException は長期トークン（約60日）の失効が典型
    const expired = json?.error?.code === 190 || json?.error?.type === 'OAuthException';
    const hint = expired ? '（THREADS_ACCESS_TOKEN の期限切れの可能性。docs/SOCIAL_AUTO_POST.md の「トークンの更新」を参照）' : '';
    const err = new Error(`Threads API ${res.status}: ${msg}${hint}`);
    err.tokenExpired = expired;
    err.status = res.status;
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  return json;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** コンテナが公開可能になるまで待つ（テキストのみなら通常は即時） */
async function waitUntilReady(containerId, accessToken, { tries = 6, intervalMs = 5000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const st = await call(containerId, { fields: 'status,error_message', access_token: accessToken }, { method: 'GET' });
    if (st.status === 'FINISHED') return;
    if (st.status === 'ERROR' || st.status === 'EXPIRED') {
      throw new Error(`Threads コンテナが ${st.status}: ${st.error_message || '詳細なし'}`);
    }
    await sleep(intervalMs);
  }
  // IN_PROGRESS のままでも公開を試す（テキスト投稿では status が返らない場合がある）
}

/**
 * @param {string} text
 * @param {object} opts { creds, replyToId?: string, linkAttachment?: string }
 * @returns {Promise<{id:string, url:string}>}
 */
export async function postToThreads(text, { creds, replyToId, linkAttachment } = {}) {
  const { userId, accessToken } = creds;

  const containerParams = { media_type: 'TEXT', text, access_token: accessToken };
  if (replyToId) containerParams.reply_to_id = replyToId;
  if (linkAttachment) containerParams.link_attachment = linkAttachment;

  const container = await call(`${userId}/threads`, containerParams);
  const creationId = container.id;
  if (!creationId) throw new Error('Threads API: コンテナ id が返りませんでした');

  await waitUntilReady(creationId, accessToken).catch(e => { throw e; });

  const published = await call(`${userId}/threads_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  });

  const id = published.id;
  if (!id) throw new Error('Threads API: 公開応答に id がありません');

  let permalink = `https://www.threads.net/@me/post/${id}`;
  try {
    const info = await call(id, { fields: 'permalink', access_token: accessToken }, { method: 'GET' });
    if (info.permalink) permalink = info.permalink;
  } catch { /* permalink 取得は必須ではない */ }

  return { id, url: permalink };
}

/** スレッド（連投）。reply_to_id で繋ぐ */
export async function postThreadToThreads(texts, { creds } = {}) {
  const results = [];
  let replyToId;
  for (const t of texts) {
    const r = await postToThreads(t, { creds, replyToId });
    results.push(r);
    replyToId = r.id;
  }
  return results;
}
