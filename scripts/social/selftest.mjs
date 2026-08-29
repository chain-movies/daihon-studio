#!/usr/bin/env node
/**
 * 外部へ一切送信せずに、投稿経路を丸ごと検証する。
 * ローカルのモックサーバーを X / Threads の代わりに立てて、
 * 署名ヘッダ・リクエスト形式・2段階公開・キュー更新までを確認する。
 *
 * 使い方: node scripts/social/selftest.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const received = [];
let failures = 0;

const check = (label, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

/* ---------- モックサーバー ---------- */
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    received.push({ url: req.url, method: req.method, headers: req.headers, body });
    const json = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

    if (req.url === '/2/tweets') return json({ data: { id: '1800000000000000001', text: 'ok' } });
    if (/\/v1\.0\/\d+\/threads$/.test(req.url)) return json({ id: 'container-1' });
    if (/\/v1\.0\/\d+\/threads_publish$/.test(req.url)) return json({ id: 'th-1' });
    if (req.url.startsWith('/v1.0/container-1?')) return json({ id: 'container-1', status: 'FINISHED' });
    if (req.url.startsWith('/v1.0/th-1?')) return json({ id: 'th-1', permalink: 'https://www.threads.net/@makky/post/abc' });

    res.writeHead(404); res.end('{}');
  });
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

/* ---------- 一時ワークスペース（本番のキューを触らない） ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-selftest-'));
fs.mkdirSync(path.join(tmp, 'content/social'), { recursive: true });
fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
for (const f of ['config.json', 'facts.json', 'templates.json']) {
  fs.cpSync(path.join(ROOT, 'content/social', f), path.join(tmp, 'content/social', f));
}

const past = new Date(Date.now() - 60000 + 9 * 3600000).toISOString().slice(0, 16) + ':00+09:00';
fs.writeFileSync(path.join(tmp, 'content/social/queue.json'), JSON.stringify({
  version: 1,
  items: [{
    id: 'selftest-1', status: 'scheduled', approved: true, scheduledAt: past,
    platforms: ['x', 'threads'], factId: 'selftest', factType: 'opinion',
    text: { x: 'セルフテストの投稿です。', threads: 'セルフテストの投稿です。' },
  }],
}, null, 2));
fs.writeFileSync(path.join(tmp, 'content/social/history.json'), '{"version":1,"items":[]}');

/* ---------- 実行 ---------- */
// spawnSync は親のイベントループを止めてモックサーバーが応答できなくなるので必ず非同期で起動する
function runPost(extraEnv = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(tmp, 'scripts/social/post.mjs')], {
      env: { ...process.env, DRY_RUN: '', X_API_BASE: base, THREADS_API_BASE: base, ...extraEnv },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

const CREDS = {
  X_API_KEY: 'ck', X_API_SECRET: 'cs', X_ACCESS_TOKEN: 'at', X_ACCESS_TOKEN_SECRET: 'as',
  THREADS_USER_ID: '1234567890', THREADS_ACCESS_TOKEN: 'th-token',
};
const run = await runPost(CREDS);

console.log(run.stdout.trim().split('\n').map(l => '   ' + l).join('\n'));
if (run.stderr.trim()) console.log(run.stderr.trim().split('\n').map(l => '   ! ' + l).join('\n'));

/* ---------- 検証 ---------- */
console.log('\n--- 検証 ---');
check('post.mjs が正常終了する', run.status === 0, `exit=${run.status}`);

const tweet = received.find(r => r.url === '/2/tweets');
check('X へ POST /2/tweets が飛ぶ', !!tweet);
check('X の Authorization が OAuth 1.0a 形式', /^OAuth oauth_consumer_key="ck"/.test(tweet?.headers?.authorization || ''));
check('X の署名が含まれる', /oauth_signature="[^"]+"/.test(tweet?.headers?.authorization || ''));
check('X の本文が JSON ボディで送られる', JSON.parse(tweet?.body || '{}').text === 'セルフテストの投稿です。');

const container = received.find(r => /\/threads$/.test(r.url));
const publish = received.find(r => /threads_publish$/.test(r.url));
check('Threads のコンテナ作成が飛ぶ', !!container);
check('Threads は media_type=TEXT で作る', /media_type=TEXT/.test(container?.body || ''));
check('Threads の公開が2段階目で飛ぶ', !!publish && /creation_id=container-1/.test(publish.body));
check('Threads のコンテナ状態を確認している', received.some(r => r.url.startsWith('/v1.0/container-1?')));

const q = JSON.parse(fs.readFileSync(path.join(tmp, 'content/social/queue.json'), 'utf8'));
const h = JSON.parse(fs.readFileSync(path.join(tmp, 'content/social/history.json'), 'utf8'));
check('キューが posted になる', q.items[0].status === 'posted', q.items[0].status);
check('投稿 URL が記録される', !!q.items[0].results?.x?.url && !!q.items[0].results?.threads?.url);
check('履歴に1件積まれる', h.items.length === 1);

/* ---------- 二重投稿しないこと ---------- */
const rerun = await runPost(CREDS);
check('posted 済みは再送されない', rerun.stdout.includes('送信対象はありません'));

server.close();

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} 件失敗しました` : '\nすべて通りました');
process.exit(failures ? 1 : 0);
