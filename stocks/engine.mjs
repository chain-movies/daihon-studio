#!/usr/bin/env node
/* =====================================================================
   仮想株式トレード・シミュレーター エンジン
   - 30万円を仮想的に運用。実在の株価（Yahoo Finance）で売買を判定
   - ルールベース戦略（モメンタム押し目）。判断理由を日本語で記録
   - 状態は stocks/data/state.json に保存（GitHub Actions が定期実行してコミット）
   使い方:
     node stocks/engine.mjs            # 通常実行（市場時間外は評価のみ）
     node stocks/engine.mjs --force    # 市場時間外でも売買判定を実行（テスト用）
     node stocks/engine.mjs --reset    # 状態を初期化（30万円に戻す）
   手動注文: stocks/manual_orders.json に [{"action":"buy","symbol":"9432","shares":100,"note":"..."}] を置く
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const STATE = path.join(DATA, 'state.json');
const ORDERS = path.join(__dirname, 'manual_orders.json');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const RESET = args.includes('--reset');
fs.mkdirSync(DATA, { recursive: true });

/* ---------- 時刻 (JST) ---------- */
const now = new Date();
const jst = (d) => new Date(d.getTime() + 9 * 3600 * 1000);
const j = jst(now);
const jstDate = j.toISOString().slice(0, 10);
const jstTime = j.toISOString().slice(11, 16);
const jstMin = j.getUTCHours() * 60 + j.getUTCMinutes();
const weekday = j.getUTCDay();
const inSession = weekday >= 1 && weekday <= 5 && ((jstMin >= 9 * 60 && jstMin < 11 * 60 + 30) || (jstMin >= 12 * 60 + 30 && jstMin <= 15 * 60 + 30));
const afterClose = weekday >= 1 && weekday <= 5 && jstMin > 15 * 60 + 30;
const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
const pct = (x) => (x * 100).toFixed(2) + '%';

/* ---------- 状態 ---------- */
function freshState() {
  return { version: 1, created_at: now.toISOString(), initial_cash: cfg.initial_cash, cash: cfg.initial_cash, positions: {}, trades: [], equity_curve: [], daily: [], last_run: null, prices: {}, signals: [], notes: [], stats: {} };
}
let state = (!RESET && fs.existsSync(STATE)) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : freshState();
if (RESET) console.log('状態を初期化しました');

/* ---------- データ取得 ---------- */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
async function getJson(url) {
  // curl があればそれを使う（プロキシ環境でも安定）。無ければ fetch
  try {
    const r = spawnSync('curl', ['-sS', '-m', '30', '-H', 'User-Agent: ' + UA, '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 50e6 });
    if (r.status === 0 && r.stdout) {
      const idx = r.stdout.lastIndexOf('\n');
      const code = Number(r.stdout.slice(idx + 1)); const body = r.stdout.slice(0, idx);
      return { status: code, ok: code >= 200 && code < 300, json: () => JSON.parse(body) };
    }
  } catch (e) { /* fall through */ }
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  return { status: r.status, ok: r.ok, json: () => r.json() };
}
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const JAR = path.join(DATA, '.yjar');
/** Yahoo の cookie + crumb を取得（429 回避に有効なことがある） */
function getCrumb() {
  try {
    spawnSync('curl', ['-sS', '-m', '15', '-A', UA, '-c', JAR, '-o', '/dev/null', 'https://fc.yahoo.com']);
    const r = spawnSync('curl', ['-sS', '-m', '15', '-A', UA, '-b', JAR, '-c', JAR, 'https://query1.finance.yahoo.com/v1/test/getcrumb'], { encoding: 'utf8' });
    const c = (r.stdout || '').trim();
    return c && !c.startsWith('<') && c.length < 40 ? c : null;
  } catch (e) { return null; }
}
function curlJson(url, useJar) {
  const args = ['-sS', '-m', '30', '-A', UA, '-w', '\n%{http_code}', url];
  if (useJar) args.unshift('-b', JAR);
  const r = spawnSync('curl', args, { encoding: 'utf8', maxBuffer: 50e6 });
  if (r.status !== 0 || !r.stdout) return { status: 0, ok: false, body: '' };
  const idx = r.stdout.lastIndexOf('\n');
  const code = Number(r.stdout.slice(idx + 1));
  return { status: code, ok: code >= 200 && code < 300, body: r.stdout.slice(0, idx) };
}
function parseSpark(js, syms) {
  const out = [];
  for (const sym of syms) {
    let d = js[sym + '.T'];
    if (!d && js.spark && js.spark.result) { const hit = js.spark.result.find((x) => x.symbol === sym + '.T'); d = hit && hit.response && hit.response[0]; if (d && d.indicators) d = { timestamp: d.timestamp, close: d.indicators.quote[0].close, chartPreviousClose: d.meta && d.meta.chartPreviousClose }; }
    if (!d || !d.close) continue;
    const closes = [], ts = [];
    for (let k = 0; k < d.close.length; k++) if (d.close[k] != null) { closes.push(d.close[k]); ts.push(d.timestamp[k]); }
    if (!closes.length) continue;
    out.push({ sym, name: (cfg.names || {})[sym] || sym, price: closes[closes.length - 1], prevClose: d.chartPreviousClose || d.previousClose || closes[closes.length - 2], marketTime: ts[ts.length - 1], closes, vols: [], ts });
  }
  return out;
}
let crumb = null;
/** spark エンドポイントで最大20銘柄を一括取得。429 なら host 切替・cookie+crumb・バックオフで再試行 */
async function fetchSpark(syms) {
  const hosts = ['query1', 'query2'];
  for (let i = 0; i < 4; i++) {
    const host = hosts[i % 2];
    const useCrumb = i >= 2;
    if (useCrumb && !crumb) crumb = getCrumb();
    const url = `https://${host}.finance.yahoo.com/v8/finance/spark?symbols=${syms.map((s) => s + '.T').join(',')}&range=3mo&interval=1d${useCrumb && crumb ? '&crumb=' + encodeURIComponent(crumb) : ''}`;
    const r = curlJson(url, useCrumb);
    if (r.ok) { try { return parseSpark(JSON.parse(r.body), syms); } catch (e) { console.error('parse fail', e.message); } }
    else console.error(`HTTP ${r.status} (${host}${useCrumb ? '+crumb' : ''}) — ${(i + 1) * 10}s 待機`);
    await sleep((i + 1) * 10000);
  }
  return [];
}

/** 日経のヒストリカルページ（日足25日分＋現在値＋出来高）を1銘柄ずつ取得 */
function fetchNikkei(sym) {
  const r = curlJson(`https://www.nikkei.com/nkd/company/history/dprice/?scode=${sym}`);
  if (!r.ok) return null;
  const h = r.body;
  const rows = [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim()));
  const data = rows.filter((c) => c.length >= 6 && /^\d{1,2}\/\d{1,2}/.test(c[0]) && !isNaN(parseFloat(c[4])));
  if (data.length < 5) return null;
  // 日付（年なし）→ 今日から遡って年を推定
  const y0 = j.getUTCFullYear(), m0 = j.getUTCMonth() + 1;
  const toTs = (md) => { const mm = md.match(/(\d{1,2})\/(\d{1,2})/); const m = Number(mm[1]), d = Number(mm[2]); const y = m > m0 ? y0 - 1 : y0; return Date.UTC(y, m - 1, d, 6, 30) / 1000; };
  const asc = data.slice().reverse();
  const closes = asc.map((c) => parseFloat(c[4])), vols = asc.map((c) => parseInt(c[5], 10) || 0), ts = asc.map((c) => toTs(c[0]));
  const nowM = h.match(/現在値\((\d{1,2}:\d{2})\)[\s\S]{0,200}?m-stockPriceElm_value now">([\d.]+)/);
  const price = nowM ? parseFloat(nowM[2]) : closes[closes.length - 1];
  // 現在値の日付: 表の最終行が今日なら今日、そうでなければ最終行の日
  const lastDate = new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10);
  let marketTime = ts[ts.length - 1];
  if (nowM && lastDate === jstDate) { const [hh, mm] = nowM[1].split(':').map(Number); marketTime = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), hh - 9, mm) / 1000; }
  const prevClose = lastDate === jstDate ? closes[closes.length - 2] : closes[closes.length - 1];
  if (lastDate === jstDate) closes[closes.length - 1] = price; // 当日行は現在値で上書き
  return { sym, name: (cfg.names || {})[sym] || sym, price, prevClose, marketTime, closes, vols, ts, source: 'nikkei' };
}
async function fetchAllNikkei(syms) {
  const out = []; let fails = 0;
  for (const sym of syms) {
    let q = null;
    for (let i = 0; i < 2 && !q; i++) { q = fetchNikkei(sym); if (!q) await sleep(1500); }
    if (q) out.push(q); else { fails++; console.error('nikkei fail', sym); if (fails >= 5 && out.length === 0) break; }
    await sleep(cfg.nikkei_interval_ms || 300);
  }
  return out;
}

/* ---------- 指標 ---------- */
function rsi(closes, n) {
  if (closes.length < n + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - n; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  if (l === 0) return 100; const rs = g / l; return 100 - 100 / (1 + rs);
}
function sma(a, n) { if (a.length < n) return null; let s = 0; for (let i = a.length - n; i < a.length; i++) s += a[i]; return s / n; }
function stdev(a) { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); }

function analyze(q) {
  const c = q.closes.slice(); // 当日分が含まれる場合、末尾は現在値相当
  const S = cfg.strategy;
  if (c.length < S.lookback + 2) return null;
  const last = q.price || c[c.length - 1];
  const ret20 = last / c[c.length - 1 - S.lookback] - 1;
  const ret5 = last / c[c.length - 6] - 1;
  const rets = []; for (let i = 1; i < c.length; i++) rets.push(c[i] / c[i - 1] - 1);
  const vol20 = stdev(rets.slice(-20)) || 0.01;
  const sma20 = sma(c, 20), sma5 = sma(c, 5);
  const avgVol = sma(q.vols, 20) || 0;
  const r = rsi(c, S.rsi_period);
  const score = ret20 / vol20; // リスク調整モメンタム
  const reasons = [];
  let ok = true;
  if (ret20 < S.min_ret20) { ok = false; reasons.push(`20日騰落 ${pct(ret20)} < 基準 ${pct(S.min_ret20)}`); }
  if (ret5 < S.max_ret5_drawdown) { ok = false; reasons.push(`直近5日で ${pct(ret5)} と急落中`); }
  if (r > S.rsi_max) { ok = false; reasons.push(`RSI(${S.rsi_period}) ${r.toFixed(0)} で買われすぎ`); }
  if (sma20 && last < sma20) { ok = false; reasons.push('20日移動平均を下回る'); }
  if (q.vols.length && avgVol < S.min_avg_volume) { ok = false; reasons.push('出来高が少ない'); }
  if (ok) reasons.push(`20日騰落 ${pct(ret20)}・RSI ${r.toFixed(0)}・上昇トレンド継続（SMA20上）`);
  return { sym: q.sym, name: q.name, price: last, ret20, ret5, rsi: r, sma20, sma5, vol20, avgVol, score, ok, reasons, chg: q.prevClose ? last / q.prevClose - 1 : 0 };
}

/* ---------- 売買 ---------- */
function exec(action, sym, shares, price, reason, source) {
  const px = price * (1 + (action === 'buy' ? cfg.slippage : -cfg.slippage));
  const amount = Math.round(px * shares);
  const fee = Math.round(amount * (cfg.commission || 0));
  const t = { t: now.toISOString(), jst: `${jstDate} ${jstTime}`, action, symbol: sym, name: (state.prices[sym] || {}).name || sym, shares, price: Math.round(px * 10) / 10, amount, fee, reason, source: source || 'auto' };
  if (action === 'buy') {
    if (amount + fee > state.cash) { t.rejected = '現金不足'; state.trades.push(t); return false; }
    state.cash -= amount + fee;
    const p = state.positions[sym] || { shares: 0, avg_price: 0, opened_at: now.toISOString(), opened_jst: jstDate, high_water: px, name: t.name };
    p.avg_price = (p.avg_price * p.shares + px * shares) / (p.shares + shares);
    p.shares += shares; p.high_water = Math.max(p.high_water, px); p.name = t.name;
    state.positions[sym] = p;
  } else {
    const p = state.positions[sym];
    if (!p || p.shares < shares) { t.rejected = '保有なし'; state.trades.push(t); return false; }
    state.cash += amount - fee;
    t.pnl = Math.round((px - p.avg_price) * shares) - fee;
    t.pnl_pct = px / p.avg_price - 1;
    t.hold_days = Math.round((now - new Date(p.opened_at)) / 86400000);
    p.shares -= shares;
    if (p.shares === 0) delete state.positions[sym];
  }
  state.trades.push(t);
  console.log(`${action === 'buy' ? '🟢 買い' : '🔴 売り'} ${sym} ${t.name} ${shares}株 @${t.price} (${fmt(amount)}円) — ${reason}`);
  return true;
}

/* ---------- メイン ---------- */
const universe = [...new Set(cfg.universe)];
console.log(`[${jstDate} ${jstTime} JST] ${universe.length}銘柄を取得中...`);
let quotes = [];
let sourceUsed = null;
for (const src of (cfg.sources || ['nikkei', 'yahoo'])) {
  if (src === 'yahoo') {
    for (let i = 0; i < universe.length; i += 20) { // 20銘柄ずつ一括取得（Yahoo のレート制限対策）
      const got = await fetchSpark(universe.slice(i, i + 20));
      if (!got.length && i === 0) { console.error('Yahoo: 最初のバッチが取得できない（このIPは制限中の可能性）'); break; }
      quotes.push(...got);
      await sleep(3000);
    }
  } else if (src === 'nikkei') {
    quotes = await fetchAllNikkei(universe);
  }
  if (quotes.length >= universe.length * 0.5) { sourceUsed = src; break; }
  console.error(`${src}: ${quotes.length}/${universe.length} 銘柄しか取れず、次のソースへ`);
  quotes = [];
}
console.log(`データソース: ${sourceUsed || 'なし'}`);
console.log(`${quotes.length}銘柄 取得完了`);
if (quotes.length < universe.length * 0.5) {
  console.error(`取得失敗が多いため中断（${quotes.length}/${universe.length}）。状態は変更しません`);
  state.notes = (state.notes || []).slice(-49).concat([{ t: now.toISOString(), note: `データ取得失敗（${quotes.length}/${universe.length}銘柄）。評価をスキップ` }]);
  if (fs.existsSync(STATE)) fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  process.exit(3); // 3 = データ取得失敗（ワークフロー側で別ランナーから再試行）
}

// 市場が今日開いているか（最新の regularMarketTime が JST の今日か）
const latestMarketDate = quotes.length ? jst(new Date(Math.max(...quotes.map((q) => q.marketTime || 0)) * 1000)).toISOString().slice(0, 10) : null;
const marketOpenToday = latestMarketDate === jstDate;
const canTrade = FORCE || (inSession && marketOpenToday);
const modeNote = FORCE ? '強制実行' : canTrade ? '取引時間中' : !marketOpenToday ? '休場日（評価のみ）' : afterClose ? '大引け後（評価のみ）' : '取引時間外（評価のみ）';

// 価格更新
for (const q of quotes) state.prices[q.sym] = { name: q.name, price: q.price, chg: q.prevClose ? q.price / q.prevClose - 1 : 0, t: q.marketTime };
const analyses = quotes.map(analyze).filter(Boolean);
const bySym = Object.fromEntries(analyses.map((a) => [a.sym, a]));

/* 手動注文 */
if (fs.existsSync(ORDERS)) {
  try {
    const orders = JSON.parse(fs.readFileSync(ORDERS, 'utf8'));
    if (Array.isArray(orders) && orders.length) {
      for (const o of orders) {
        const px = (state.prices[o.symbol] || {}).price;
        if (!px) { console.log('手動注文: 価格なし', o.symbol); continue; }
        exec(o.action, o.symbol, o.shares || cfg.lot_size, px, `手動注文: ${o.note || ''}`, 'manual');
      }
      fs.writeFileSync(ORDERS, '[]\n');
    }
  } catch (e) { console.error('manual_orders.json 読み込み失敗', e.message); }
}

/* 決済判定（保有銘柄） */
const S = cfg.strategy;
for (const [sym, p] of Object.entries(state.positions)) {
  const a = bySym[sym]; const px = (state.prices[sym] || {}).price; if (!px) continue;
  p.high_water = Math.max(p.high_water || px, px);
  const gain = px / p.avg_price - 1;
  const fromHigh = px / p.high_water - 1;
  const days = Math.round((now - new Date(p.opened_at)) / 86400000);
  let why = null;
  if (gain <= S.stop_loss) why = `損切り（${pct(gain)} ≤ ${pct(S.stop_loss)}）`;
  else if (gain >= S.take_profit) why = `利確（${pct(gain)} ≥ ${pct(S.take_profit)}）`;
  else if (gain >= S.trailing_arm && fromHigh <= -S.trailing_stop) why = `トレーリングストップ（高値から ${pct(fromHigh)}）`;
  else if (a && a.sma20 && px < a.sma20 && gain < 0) why = 'トレンド崩れ（20日線割れ・含み損）';
  else if (days >= S.max_hold_days) why = `保有${days}日で期限（${S.max_hold_days}日）`;
  if (why && canTrade) exec('sell', sym, p.shares, px, why);
  else if (why) state.notes.push({ t: now.toISOString(), note: `${sym} ${why} → 次の取引時間に売却予定` });
}

/* 新規エントリー */
const candidates = analyses.filter((a) => a.ok && !state.positions[a.sym]).sort((a, b) => b.score - a.score);
state.signals = analyses.sort((a, b) => b.score - a.score).slice(0, 15).map((a) => ({ sym: a.sym, name: a.name, price: a.price, ret20: a.ret20, ret5: a.ret5, rsi: a.rsi, score: a.score, ok: a.ok, chg: a.chg, reason: a.reasons.join(' / '), affordable: a.price * cfg.lot_size <= state.cash }));
if (canTrade) {
  const todayBuys = new Set(state.trades.filter((t) => t.action === 'buy' && t.jst.startsWith(jstDate)).map((t) => t.symbol));
  for (const a of candidates) {
    if (Object.keys(state.positions).length >= cfg.max_positions) break;
    if (S.one_entry_per_symbol_per_day && todayBuys.has(a.sym)) continue;
    const slots = cfg.max_positions - Object.keys(state.positions).length;
    const budget = state.cash / slots; // 残り枠で均等配分
    const lots = Math.floor(budget / (a.price * cfg.lot_size * (1 + cfg.slippage)));
    if (lots < 1) continue;
    exec('buy', a.sym, lots * cfg.lot_size, a.price, `新規: ${a.reasons.join(' / ')}（スコア ${a.score.toFixed(2)}）`);
  }
}

/* 評価 */
let mv = 0;
for (const [sym, p] of Object.entries(state.positions)) { const px = (state.prices[sym] || {}).price || p.avg_price; p.price = px; p.value = Math.round(px * p.shares); p.pnl = Math.round((px - p.avg_price) * p.shares); p.pnl_pct = px / p.avg_price - 1; mv += p.value; }
const equity = Math.round(state.cash + mv);
state.equity_curve.push({ t: now.toISOString(), jst: `${jstDate} ${jstTime}`, equity, cash: Math.round(state.cash), mv: Math.round(mv) });
if (state.equity_curve.length > 3000) state.equity_curve = state.equity_curve.slice(-3000);
// 日次（大引け後の値で上書き）
const dIdx = state.daily.findIndex((d) => d.date === jstDate);
const dRec = { date: jstDate, equity, cash: Math.round(state.cash), mv: Math.round(mv) };
if (dIdx >= 0) state.daily[dIdx] = dRec; else state.daily.push(dRec);
const closed = state.trades.filter((t) => t.action === 'sell' && !t.rejected);
const wins = closed.filter((t) => t.pnl > 0);
state.stats = {
  equity, pnl: equity - state.initial_cash, pnl_pct: equity / state.initial_cash - 1,
  cash: Math.round(state.cash), market_value: Math.round(mv), positions: Object.keys(state.positions).length,
  trades: state.trades.filter((t) => !t.rejected).length, closed: closed.length, wins: wins.length,
  win_rate: closed.length ? wins.length / closed.length : null,
  realized: closed.reduce((s, t) => s + t.pnl, 0),
  max_equity: Math.max(equity, ...state.equity_curve.map((e) => e.equity)),
  max_drawdown: (() => { let peak = 0, mdd = 0; for (const e of state.equity_curve) { peak = Math.max(peak, e.equity); mdd = Math.min(mdd, e.equity / peak - 1); } return mdd; })(),
  days_running: Math.max(1, Math.round((now - new Date(state.created_at)) / 86400000)),
};
state.last_run = { t: now.toISOString(), jst: `${jstDate} ${jstTime}`, mode: modeNote, quotes: quotes.length, market_date: latestMarketDate, source: sourceUsed };
state.notes = state.notes.slice(-50);
state.config = { lot_size: cfg.lot_size, max_positions: cfg.max_positions, strategy: cfg.strategy, initial_cash: cfg.initial_cash };
fs.writeFileSync(STATE, JSON.stringify(state, null, 1));

/* レポート */
const pos = Object.entries(state.positions).map(([s, p]) => `- ${s} ${p.name}: ${p.shares}株 @${fmt(p.avg_price)} → ${fmt(p.price)}（${p.pnl >= 0 ? '+' : ''}${fmt(p.pnl)}円 / ${pct(p.pnl_pct)}）`).join('\n') || '- なし（全額現金）';
const recent = state.trades.filter((t) => !t.rejected).slice(-8).reverse().map((t) => `- ${t.jst} ${t.action === 'buy' ? '買' : '売'} ${t.symbol} ${t.name} ${t.shares}株 @${fmt(t.price)}${t.pnl != null ? `（${t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)}円）` : ''} — ${t.reason}`).join('\n') || '- なし';
const top = state.signals.slice(0, 5).map((s) => `- ${s.sym} ${s.name} ${fmt(s.price)}円 20日${pct(s.ret20)} RSI${s.rsi.toFixed(0)} ${s.ok ? '✅候補' : '—'}${s.affordable ? '' : '（1単元買えない）'}`).join('\n');
fs.writeFileSync(path.join(DATA, 'report.md'), `# 仮想トレード日報 ${jstDate} ${jstTime} JST（${modeNote}）

**評価額 ${fmt(equity)}円**（元本 ${fmt(state.initial_cash)}円 / 損益 ${state.stats.pnl >= 0 ? '+' : ''}${fmt(state.stats.pnl)}円 = ${pct(state.stats.pnl_pct)}）
現金 ${fmt(state.cash)}円 ・ 株式 ${fmt(mv)}円 ・ 実現損益 ${fmt(state.stats.realized)}円 ・ 勝率 ${state.stats.win_rate == null ? '—' : pct(state.stats.win_rate)}（${closed.length}回決済）・ 最大DD ${pct(state.stats.max_drawdown)}

## 保有
${pos}

## 直近の売買
${recent}

## シグナル上位（リスク調整モメンタム）
${top}

戦略: ${cfg.strategy.name} / 単元 ${cfg.lot_size}株 / 最大 ${cfg.max_positions}銘柄 / 損切り ${pct(S.stop_loss)} 利確 ${pct(S.take_profit)} トレーリング ${pct(S.trailing_stop)}
`);
console.log(`\n評価額 ${fmt(equity)}円 (損益 ${state.stats.pnl >= 0 ? '+' : ''}${fmt(state.stats.pnl)}円) / 現金 ${fmt(state.cash)}円 / 保有 ${Object.keys(state.positions).length}銘柄 / ${modeNote}`);
