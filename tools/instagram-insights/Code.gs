/**
 * Instagram インサイト自動収集（Google Apps Script）
 *
 * Instagram Graph API（Instagram Login / graph.instagram.com）から
 * 投稿単位・アカウント単位のインサイトを取得し、スプレッドシートに蓄積する。
 *
 * 設計方針
 *  - スクレイピングは一切しない。公式APIのみを使う
 *  - アクセストークンはコードに書かない。スクリプトプロパティに保存する
 *  - Meta側の指標名は頻繁に変わるため、使える指標を自動で探索してキャッシュする
 *    （未対応の指標が1つ混ざっても収集全体が止まらない）
 *
 * 動作確認済み仕様（2026-09時点・公式ドキュメント）
 *  - APIバージョン v25.0
 *  - メディア単位は saved / アカウント単位は saves（名前が違う）
 *  - impressions は廃止済み。後継は views
 *  - ig_reels_avg_watch_time はミリ秒で返る
 *  - profile_visits と follows は FEED / STORY のみ。REELS では取得できない
 *  - follower_demographics は フォロワー100人以上のアカウントのみ
 */

// ===== 設定 =====

const API_VERSION = 'v25.0';
const HOST = 'https://graph.instagram.com';

/** 1回の実行で遡る日数（アカウント日次インサイト） */
const DAYS_BACK = 30;

/** 1回の実行で取得する投稿の最大件数 */
const MAX_MEDIA = 100;

/** メディア種別ごとの指標候補。使えないものは自動で除外される */
const MEDIA_METRIC_CANDIDATES = {
  REELS: ['views', 'reach', 'likes', 'comments', 'saved', 'shares',
          'total_interactions', 'reposts',
          'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate'],
  FEED:  ['views', 'reach', 'likes', 'comments', 'saved', 'shares',
          'total_interactions', 'reposts', 'follows', 'profile_visits', 'profile_activity'],
  STORY: ['views', 'reach', 'replies', 'navigation', 'link_clicks',
          'follows', 'profile_visits', 'shares', 'total_interactions', 'reposts'],
};

/** アカウント日次インサイトの指標候補 */
const ACCOUNT_METRIC_CANDIDATES = [
  'reach', 'views', 'likes', 'comments', 'saves', 'shares', 'replies', 'reposts',
  'total_interactions', 'accounts_engaged', 'profile_links_taps', 'follows_and_unfollows',
];

/** フォロワー属性の内訳 */
const DEMOGRAPHIC_BREAKDOWNS = ['age', 'gender', 'city', 'country'];

const SHEET = {
  CONFIG: '設定',
  MEDIA: '投稿',
  DAILY: 'アカウント日次',
  DEMO: 'フォロワー属性',
  LOG: 'ログ',
};

// ===== 初期セットアップ =====

/**
 * 【最初に1回だけ手で実行する】
 * アカウントの長期トークンをスクリプトプロパティに保存する。
 * 実行後、この関数内の文字列は必ず消すこと（履歴に残さないため）。
 */
function セットアップ_トークンを保存() {
  const 保存する = {
    // 'アカウントキー': '長期アクセストークン',
    // 例: 'kuriseka': 'IGQVJ...',
    // 例: 'kandora': 'IGQVJ...',
  };
  if (Object.keys(保存する).length === 0) {
    throw new Error('保存するトークンが空です。この関数内にアカウントキーとトークンを書いてから実行してください。');
  }
  const props = PropertiesService.getScriptProperties();
  Object.keys(保存する).forEach(function (key) {
    props.setProperty('TOKEN_' + key, 保存する[key]);
  });
  Logger.log('保存しました: ' + Object.keys(保存する).join(', ') + '\nこの関数内のトークン文字列を今すぐ削除してください。');
}

/** 【最初に1回だけ】シートの雛形を作る */
function セットアップ_シートを作る() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET.CONFIG, ['アカウントキー', 'IGユーザーID', '表示名', '有効']);
  ensureSheet_(ss, SHEET.MEDIA, [
    '取得日時', 'アカウント', '投稿日', '種別', 'タイトル(冒頭)', 'permalink',
    'views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'reposts',
    '平均視聴秒', 'スキップ率', 'follows', 'profile_visits',
    '保存率%', 'シェア率%', 'エンゲージメント率%', 'フォロー転換率%', 'media_id',
  ]);
  ensureSheet_(ss, SHEET.DAILY, ['取得日時', 'アカウント', '集計開始日', '集計終了日', '指標', '内訳', '値']);
  ensureSheet_(ss, SHEET.DEMO, ['取得日時', 'アカウント', '内訳', '区分', '値']);
  ensureSheet_(ss, SHEET.LOG, ['日時', '種別', '内容']);

  const cfg = ss.getSheetByName(SHEET.CONFIG);
  if (cfg.getLastRow() === 1) {
    cfg.appendRow(['kuriseka', '', 'クリセカ', true]);
    cfg.appendRow(['kandora', '', '看ドラ', true]);
  }
  SpreadsheetApp.getUi && Logger.log('シートを作成しました。設定シートに IGユーザーID を入れてください。');
}

/** 【任意】自分のIGユーザーIDを調べる。トークン保存後に実行 */
function 確認_ユーザーIDを取得() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).filter(function (k) { return k.indexOf('TOKEN_') === 0; }).forEach(function (k) {
    const key = k.replace('TOKEN_', '');
    const res = fetchJson_('/me', { fields: 'id,username,account_type', access_token: props[k] });
    Logger.log(key + ' → ' + JSON.stringify(res));
  });
}

// ===== メイン =====

/** 【日次トリガーに登録する】全アカウントを収集 */
function 収集() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const accounts = readAccounts_(ss);
  if (accounts.length === 0) {
    log_(ss, 'エラー', '設定シートに有効なアカウントがありません');
    return;
  }
  accounts.forEach(function (acc) {
    try {
      collectMedia_(ss, acc);
      collectAccountDaily_(ss, acc);
      collectDemographics_(ss, acc);
      log_(ss, '完了', acc.name + ' の収集を終了');
    } catch (e) {
      log_(ss, 'エラー', acc.name + ': ' + e.message);
    }
  });
}

/** 【月次トリガーに登録する】長期トークンを延長（60日で失効するため） */
function 月次_トークン更新() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).filter(function (k) { return k.indexOf('TOKEN_') === 0; }).forEach(function (k) {
    try {
      const res = fetchJson_('/refresh_access_token', {
        grant_type: 'ig_refresh_token',
        access_token: all[k],
      });
      if (res && res.access_token) {
        props.setProperty(k, res.access_token);
        log_(ss, 'トークン', k + ' を更新（残り ' + Math.round((res.expires_in || 0) / 86400) + '日）');
      } else {
        log_(ss, 'エラー', k + ' のトークン更新に失敗: ' + JSON.stringify(res));
      }
    } catch (e) {
      log_(ss, 'エラー', k + ' のトークン更新で例外: ' + e.message);
    }
  });
}

// ===== 収集処理 =====

function collectMedia_(ss, acc) {
  const sheet = ss.getSheetByName(SHEET.MEDIA);
  const known = existingIds_(sheet, 23); // media_id 列
  const media = listMedia_(acc);
  const rows = [];
  const now = new Date();

  media.forEach(function (m) {
    if (known[m.id]) return; // 既に取得済みはスキップ
    const type = normalizeType_(m.media_product_type, m.media_type);
    const metrics = usableMetrics_(acc, type, MEDIA_METRIC_CANDIDATES[type] || []);
    const ins = metrics.length ? mediaInsights_(acc, m.id, metrics) : {};

    const views = num_(ins.views);
    const reach = num_(ins.reach);
    const saved = num_(ins.saved);
    const shares = num_(ins.shares);
    const likes = num_(ins.likes !== undefined ? ins.likes : m.like_count);
    const comments = num_(ins.comments !== undefined ? ins.comments : m.comments_count);
    const follows = num_(ins.follows);
    const base = reach || views; // reach 優先、無ければ views を母数にする

    rows.push([
      now,
      acc.name,
      m.timestamp ? new Date(m.timestamp) : '',
      type,
      firstLine_(m.caption),
      m.permalink || '',
      views, reach, likes, comments, saved, shares,
      num_(ins.total_interactions), num_(ins.reposts),
      ins.ig_reels_avg_watch_time !== undefined ? Math.round(num_(ins.ig_reels_avg_watch_time) / 1000 * 10) / 10 : '',
      ins.reels_skip_rate !== undefined ? num_(ins.reels_skip_rate) : '',
      follows,
      num_(ins.profile_visits),
      pct_(saved, base), pct_(shares, base),
      pct_(likes + comments + saved + shares, base),
      pct_(follows, base),
      m.id,
    ]);
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    log_(ss, '投稿', acc.name + ' 新規 ' + rows.length + '件');
  } else {
    log_(ss, '投稿', acc.name + ' 新規なし');
  }
}

function collectAccountDaily_(ss, acc) {
  const sheet = ss.getSheetByName(SHEET.DAILY);
  const metrics = usableMetrics_(acc, 'ACCOUNT_DAY', ACCOUNT_METRIC_CANDIDATES);
  if (!metrics.length) return;

  const until = Math.floor(Date.now() / 1000);
  const since = until - DAYS_BACK * 86400;
  const now = new Date();
  const rows = [];

  // metric_type=total_value は since〜until を1つに合算した値を返す（日別内訳ではない）。
  // そのため行には集計期間の開始日と終了日の両方を記録する。
  // エラーの切り分けを容易にするため、指標は1つずつ投げる。
  metrics.forEach(function (metric) {
    const res = fetchJson_('/' + acc.id + '/insights', {
      metric: metric,
      period: 'day',
      metric_type: 'total_value',
      since: since,
      until: until,
      access_token: acc.token,
    });
    if (!res || !res.data) return;
    res.data.forEach(function (d) {
      const tv = d.total_value;
      if (!tv) return;
      if (tv.breakdowns && tv.breakdowns.length) {
        tv.breakdowns.forEach(function (b) {
          (b.results || []).forEach(function (r) {
            rows.push([now, acc.name, formatDay_(since), formatDay_(until), d.name, (r.dimension_values || []).join('/'), num_(r.value)]);
          });
        });
      } else if (tv.value !== undefined) {
        rows.push([now, acc.name, formatDay_(since), formatDay_(until), d.name, '', num_(tv.value)]);
      }
    });
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    log_(ss, 'アカウント', acc.name + ' 日次 ' + rows.length + '行');
  }
}

function collectDemographics_(ss, acc) {
  const sheet = ss.getSheetByName(SHEET.DEMO);
  const now = new Date();
  const rows = [];

  DEMOGRAPHIC_BREAKDOWNS.forEach(function (bd) {
    const res = fetchJson_('/' + acc.id + '/insights', {
      metric: 'follower_demographics',
      period: 'lifetime',
      metric_type: 'total_value',
      timeframe: 'this_month',
      breakdown: bd,
      access_token: acc.token,
    });
    if (!res || !res.data) {
      // フォロワー100人未満だとここでエラーになる。想定内なので握りつぶす
      return;
    }
    res.data.forEach(function (d) {
      const tv = d.total_value || {};
      (tv.breakdowns || []).forEach(function (b) {
        (b.results || []).forEach(function (r) {
          rows.push([now, acc.name, bd, (r.dimension_values || []).join('/'), num_(r.value)]);
        });
      });
    });
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    log_(ss, '属性', acc.name + ' ' + rows.length + '行');
  } else {
    log_(ss, '属性', acc.name + ' 取得なし（フォロワー100人未満の可能性）');
  }
}

// ===== API =====

function listMedia_(acc) {
  const res = fetchJson_('/' + acc.id + '/media', {
    fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count',
    limit: MAX_MEDIA,
    access_token: acc.token,
  });
  return (res && res.data) ? res.data : [];
}

function mediaInsights_(acc, mediaId, metrics) {
  const res = fetchJson_('/' + mediaId + '/insights', {
    metric: metrics.join(','),
    access_token: acc.token,
  });
  const out = {};
  if (res && res.data) {
    res.data.forEach(function (d) {
      if (d.values && d.values.length && d.values[0].value !== undefined) {
        out[d.name] = d.values[0].value;
      } else if (d.total_value && d.total_value.value !== undefined) {
        out[d.name] = d.total_value.value;
      }
    });
  }
  return out;
}

/**
 * 使える指標を探索してキャッシュする。
 * Meta側で指標名が変わっても、収集全体が止まらないようにするための仕組み。
 */
function usableMetrics_(acc, type, candidates) {
  if (!candidates.length) return [];
  const props = PropertiesService.getScriptProperties();
  const cacheKey = 'METRICS_' + acc.key + '_' + type;
  const cached = props.getProperty(cacheKey);
  if (cached) return JSON.parse(cached);

  // まとめて試し、通ればそのまま採用
  const probe = (type === 'ACCOUNT_DAY')
    ? function (list) {
        const until = Math.floor(Date.now() / 1000);
        return fetchJson_('/' + acc.id + '/insights', {
          metric: list.join(','), period: 'day', metric_type: 'total_value',
          since: until - 2 * 86400, until: until, access_token: acc.token,
        });
      }
    : function (list) {
        const m = listMedia_(acc).filter(function (x) {
          return normalizeType_(x.media_product_type, x.media_type) === type;
        })[0];
        if (!m) return { __skip: true };
        return fetchJson_('/' + m.id + '/insights', { metric: list.join(','), access_token: acc.token });
      };

  let ok = probe(candidates);
  if (ok && ok.__skip) return []; // その種別の投稿がまだ無い。キャッシュしない
  if (ok && !ok.error) {
    props.setProperty(cacheKey, JSON.stringify(candidates));
    return candidates;
  }

  // 1つずつ試して、通るものだけ残す
  const survivors = [];
  candidates.forEach(function (m) {
    const r = probe([m]);
    if (r && r.__skip) return;
    if (r && !r.error) survivors.push(m);
    Utilities.sleep(300);
  });
  props.setProperty(cacheKey, JSON.stringify(survivors));
  return survivors;
}

/** 指標キャッシュを消す。Meta側の仕様変更後に一度実行する */
function 指標キャッシュを消す() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf('METRICS_') === 0) props.deleteProperty(k);
  });
  Logger.log('指標キャッシュを削除しました');
}

function fetchJson_(path, params) {
  const qs = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  const url = HOST + '/' + API_VERSION + path + '?' + qs;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = res.getResponseCode();
    const body = res.getContentText();

    if (code === 200) {
      try { return JSON.parse(body); } catch (e) { return null; }
    }
    // レート制限・一時エラーは待って再試行
    if (code === 429 || code >= 500) {
      Utilities.sleep(Math.pow(2, attempt) * 2000);
      continue;
    }
    // 400番台は指標名が不正なケースが多い。呼び出し元で判定させる
    try { return JSON.parse(body); } catch (e) { return { error: { message: body } }; }
  }
  return { error: { message: 'リトライ上限に到達しました' } };
}

// ===== ユーティリティ =====

function readAccounts_(ss) {
  const sheet = ss.getSheetByName(SHEET.CONFIG);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const props = PropertiesService.getScriptProperties();
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return r[0] && r[1] && r[3] !== false; })
    .map(function (r) {
      return {
        key: String(r[0]).trim(),
        id: String(r[1]).trim(),
        name: String(r[2] || r[0]).trim(),
        token: props.getProperty('TOKEN_' + String(r[0]).trim()),
      };
    })
    .filter(function (a) {
      if (!a.token) { Logger.log('トークン未設定のためスキップ: ' + a.key); return false; }
      return true;
    });
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f0f0f0');
    sh.setFrozenRows(1);
  }
  return sh;
}

function existingIds_(sheet, col) {
  const out = {};
  if (sheet.getLastRow() < 2) return out;
  sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues()
    .forEach(function (r) { if (r[0]) out[r[0]] = true; });
  return out;
}

function normalizeType_(productType, mediaType) {
  const p = String(productType || '').toUpperCase();
  if (p === 'REELS' || p === 'STORY') return p;
  if (p === 'FEED' || p === 'AD') return 'FEED';
  return String(mediaType || '').toUpperCase() === 'VIDEO' ? 'REELS' : 'FEED';
}

function firstLine_(caption) {
  if (!caption) return '';
  const line = String(caption).split('\n')[0];
  return line.length > 60 ? line.slice(0, 60) + '…' : line;
}

function num_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

function pct_(numerator, denominator) {
  if (!denominator) return '';
  return Math.round(numerator / denominator * 10000) / 100;
}

function formatDay_(unixSec) {
  return Utilities.formatDate(new Date(unixSec * 1000), 'Asia/Tokyo', 'yyyy-MM-dd');
}

function log_(ss, kind, message) {
  const sh = ss.getSheetByName(SHEET.LOG);
  if (sh) sh.appendRow([new Date(), kind, message]);
  Logger.log(kind + ': ' + message);
}
