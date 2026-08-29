/* OAuth 1.0a (HMAC-SHA1) 署名 — X API v2 のユーザーコンテキスト用。外部依存なし */
import crypto from 'node:crypto';

export function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * @param {object} o
 * @param {string} o.method  HTTP メソッド
 * @param {string} o.url     クエリを含まない URL
 * @param {object} [o.params] 署名対象のクエリ／フォームパラメータ（JSON ボディは含めない）
 * @param {object} o.creds   { consumerKey, consumerSecret, accessToken, accessSecret }
 * @param {object} [o.overrides] nonce / timestamp の固定（テスト用）
 */
export function buildAuthHeader({ method, url, params = {}, creds, overrides = {} }) {
  const oauth = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
    ...overrides,
  };

  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .map(k => [percentEncode(k), percentEncode(String(all[k]))])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join('&');

  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.accessSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  const header = Object.entries({ ...oauth, oauth_signature: signature })
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ');

  return `OAuth ${header}`;
}
