#!/usr/bin/env node
/* 株価データ提供元の到達性テスト（GitHub Actions のIPからどれが使えるか調べる）
   node stocks/probe.mjs */
import { spawnSync } from 'node:child_process';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
function curl(url, extra = []) {
  const r = spawnSync('curl', ['-sS', '-L', '-m', '25', '-A', UA, ...extra, '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 20e6 });
  const idx = r.stdout.lastIndexOf('\n');
  return { code: Number(r.stdout.slice(idx + 1)), body: r.stdout.slice(0, idx), err: r.stderr.trim() };
}
const tests = [];
const log = (name, r, ok, note) => { tests.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}: HTTP ${r.code} ${note || ''} ${r.err ? '(' + r.err.slice(0, 80) + ')' : ''}`); };

// 1. Yahoo spark
let r = curl('https://query1.finance.yahoo.com/v8/finance/spark?symbols=9432.T,7267.T&range=1mo&interval=1d');
log('yahoo spark', r, r.code === 200 && r.body.includes('close'), r.body.slice(0, 80).replace(/\s+/g, ' '));
// 2. Yahoo chart
r = curl('https://query2.finance.yahoo.com/v8/finance/chart/9432.T?interval=1d&range=1mo');
log('yahoo chart', r, r.code === 200 && r.body.includes('regularMarketPrice'), r.body.slice(0, 80).replace(/\s+/g, ' '));
// 3. Yahoo with cookie + crumb
{
  const jar = '/tmp/yjar.txt';
  const c1 = curl('https://fc.yahoo.com', ['-c', jar, '-o', '/dev/null']);
  const crumb = curl('https://query1.finance.yahoo.com/v1/test/getcrumb', ['-b', jar, '-c', jar]);
  const cr = crumb.body.trim();
  r = cr && !cr.startsWith('<') ? curl(`https://query2.finance.yahoo.com/v8/finance/chart/9432.T?interval=1d&range=1mo&crumb=${encodeURIComponent(cr)}`, ['-b', jar]) : { code: 0, body: '', err: 'no crumb: ' + crumb.code + ' ' + cr.slice(0, 40) };
  log('yahoo chart+crumb', r, r.code === 200 && r.body.includes('regularMarketPrice'), `(fc ${c1.code}, crumb ${crumb.code} "${cr.slice(0, 12)}")`);
}
// 4. Stooq daily CSV
r = curl('https://stooq.com/q/d/l/?s=9432.jp&i=d');
log('stooq daily csv', r, r.code === 200 && /^Date,Open/m.test(r.body), r.body.split('\n').slice(-2).join(' | ').slice(0, 80));
// 5. Google Finance quote page
r = curl('https://www.google.com/finance/quote/9432:TYO?hl=ja', ['-H', 'Cookie: CONSENT=YES+cb; SOCS=CAI', '-H', 'Accept-Language: ja']);
const m = r.body.match(/data-last-price="([^"]+)"/);
log('google finance quote', r, r.code === 200 && !!m, m ? 'price=' + m[1] : 'no data-last-price (' + r.body.length + ' bytes)');
// 6. Yahoo Finance Japan quote page
r = curl('https://finance.yahoo.co.jp/quote/9432.T');
const m2 = r.body.match(/"price":"?([0-9.,]+)/) || r.body.match(/_3rXWJKZF[^>]*>([0-9,.]+)</);
log('yahoo japan page', r, r.code === 200 && r.body.length > 10000, `${r.body.length} bytes ${m2 ? 'price~' + m2[1] : ''}`);
// 7. kabutan
r = curl('https://kabutan.jp/stock/kabuka?code=9432');
log('kabutan kabuka', r, r.code === 200 && r.body.includes('kabuka'), `${r.body.length} bytes`);
// 8. Nikkei
r = curl('https://www.nikkei.com/nkd/company/history/dprice/?scode=9432');
log('nikkei dprice', r, r.code === 200 && r.body.length > 10000, `${r.body.length} bytes`);
// 9. minkabu
r = curl('https://minkabu.jp/stock/9432/daily_bar');
log('minkabu daily', r, r.code === 200 && r.body.length > 10000, `${r.body.length} bytes`);
console.log('\nSUMMARY ' + JSON.stringify(tests));
