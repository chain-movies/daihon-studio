# X / Threads 自動投稿

GitHub Actions だけで動く自動投稿の仕組み。サーバー不要・追加費用ゼロ（API の無料枠内）。

- **何を投稿するか** — `content/social/facts.json` に書いた事実だけ。AI が文章を創作することはない
- **いつ投稿するか** — `content/social/config.json` の `dailySlots`（既定は 07:30 / 12:20 / 19:40 JST）
- **どこへ** — X と Threads の両方（片方だけにもできる）

---

## 全体の流れ

```
facts.json（事実バンク）
   ↓  SNS 下書き生成（毎朝 06:10 JST）
queue.json（予約キュー）      ← 手動の予約もここに入る
   ↓  SNS 自動投稿（15分おき／予定時刻を過ぎたものだけ）
X / Threads へ送信
   ↓
history.json（投稿履歴・ネタの重複防止と週次分析に使う）
```

| ファイル | 役割 |
|---|---|
| `content/social/facts.json` | 投稿の素材。**ここを更新するのが日々の唯一の作業** |
| `content/social/templates.json` | 型ごとの本文の組み立て方 |
| `content/social/config.json` | 時刻・投稿先・承認・CTA の設定 |
| `content/social/queue.json` | 予約中の投稿 |
| `content/social/history.json` | 投稿済みの記録 |

---

## セットアップ

### 1. X（Twitter）の鍵を取る

1. https://developer.x.com/ でアプリを作る（Free プランで可）
2. アプリの **User authentication settings** を開き
   - App permissions: **Read and write**
   - Type of App: **Web App, Automated App or Bot**
   - Callback URI / Website URL: 何でもよい（`https://example.com` 等）
3. **Keys and tokens** タブで4つを取得
   - API Key / API Key Secret（Consumer Keys）
   - Access Token / Access Token Secret

> **落とし穴**：権限を Read and write に変えた *あと* に Access Token を再生成すること。
> 権限変更前に発行したトークンでは投稿が 403 で失敗する。

### 2. Threads の鍵を取る

1. https://developers.facebook.com/ でアプリを作り、ユースケースに **Threads API** を追加
2. 権限は `threads_basic` と `threads_content_publish` の2つ
3. 投稿したい Threads アカウントを接続して短期アクセストークンを取得
4. 短期 → 長期（約60日）に交換する

```
curl -s "https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=<アプリのシークレット>&access_token=<短期トークン>"
```

5. ユーザー ID を確認する

```
curl -s "https://graph.threads.net/v1.0/me?fields=id,username&access_token=<長期トークン>"
```

### 3. GitHub に登録する

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で6つ登録する。

| 名前 | 中身 |
|---|---|
| `X_API_KEY` | X の API Key |
| `X_API_SECRET` | X の API Key Secret |
| `X_ACCESS_TOKEN` | X の Access Token |
| `X_ACCESS_TOKEN_SECRET` | X の Access Token Secret |
| `THREADS_USER_ID` | 手順2-5 で確認した id |
| `THREADS_ACCESS_TOKEN` | 長期アクセストークン |

### 4. 定期実行を有効にする

**GitHub Actions の `schedule` はデフォルトブランチでしか動かない。**
このブランチを `main` にマージするまで、自動実行は始まらない（手動実行は今でも可能）。

Settings → Actions → General → Workflow permissions を
**Read and write permissions** にしておくこと（キューの書き戻しに必要）。

---

## 使う

### 何もしなくていい状態

毎朝 06:10 JST に3日先までの下書きが自動で作られ、07:30 / 12:20 / 19:40 に自動で投稿される。
やることは `facts.json` にネタを足すことだけ。

### 単発で投稿を予約する

Actions → **SNS 投稿を1件予約** → Run workflow。本文と時刻（`2026-09-01T07:30` / `now+30m` / `now`）を入れる。

手元からなら:

```bash
node scripts/social/enqueue.mjs --text "本文" --at "2026-09-01T07:30" --platforms x,threads
```

### 投稿前に中身を確認する

```bash
node scripts/social/generate.mjs --days 3 --dry-run   # 生成される文面を見る
DRY_RUN=1 node scripts/social/post.mjs                # 送信対象と文面を見る（送信しない）
node scripts/social/selftest.mjs                      # 送信経路の検証（外部へは送らない）
```

### 止める

| やりたいこと | 方法 |
|---|---|
| 全部止める | Actions → 各ワークフロー → `···` → Disable workflow |
| 片方の SNS だけ止める | `config.json` の `platforms` から `"x"` か `"threads"` を外す |
| 自動投稿はせず下書きだけ作る | `config.json` の `autoApproveGenerated` を `false` に |
| 特定の1件を止める | `queue.json` のその項目の `approved` を `false` に |

---

## ネタを足す

`content/social/facts.json` の `items` に追加するだけ。

```json
{
  "id": "任意の一意な文字列",
  "type": "jitsuroku",
  "hook": "1行目に来る一番強い事実。",
  "detail": "根拠・状況・数字。",
  "lesson": "だから何が言えるか。",
  "audience": "周年",
  "tags": ["周年記念"]
}
```

`type` は `jitsuroku`（実録）/ `know-how`（ノウハウ）/ `number`（数字）/ `opinion`（持論）の4つ。
本文は `hook` / `detail` / `lesson` を型どおりに並べたものになるので、**ここに書いた事実以外は出ない**。
X の上限（全角140相当）を超える分は末尾が自動で切り詰められるので、`hook` は短く書くほど良い。

ネタは `dedupeWindowDays`（既定10日）以内に使ったものを避け、直前と同じ型が続かないように選ばれる。
ネタが尽きると、最後に使った日が古いものから再利用される。

### 問い合わせ導線（CTA）

`config.json` の `cta` に URL と文言を入れると、`everyNthPost` 件に1回だけ末尾に付く。
`url` が空のままでも壊れない（リンクなしで投稿される）。

---

## 制限とコスト

| | 上限 | この設定での使用量 |
|---|---|---|
| X（Free） | 書き込みが月500件程度（プランの改定が多いので開発者ポータルで要確認） | 1日3本 = 月約90件 |
| Threads | 1日250件 | 1日3本 |

`dailySlots` を増やすと X の無料枠に当たる可能性がある。**有料プランは月額課金なので、契約前に必ず確認すること。**

GitHub Actions は public リポジトリなら無料、private でも1回数秒なので無料枠にほぼ影響しない。
`schedule` の cron は GitHub 側の混雑で数分〜十数分遅れることがある（予定より遅れて投稿される）。
予定時刻を `staleAfterMinutes`（既定180分）以上過ぎた投稿は、深夜の誤爆を避けるため送らずに `skipped` になる。

---

## トークンの更新

**Threads の長期トークンは約60日で失効する。** 失効すると Threads だけ投稿が止まる（X は動き続ける）。
毎月1日に更新を促す Issue が自動で立つ。有効なうちに:

```
curl -s "https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=<現在のトークン>"
```

返ってきた `access_token` で Secret の `THREADS_ACCESS_TOKEN` を上書きする。

X の Access Token は自分で再生成しない限り失効しない。

---

## うまくいかないとき

| 症状 | 原因 |
|---|---|
| X が 403 | 権限を Read and write にした後に Access Token を再生成していない |
| X が 401 | Secret のコピー時に空白や改行が混ざっている |
| X が 429 | 無料枠の書き込み上限に到達。翌月まで待つかスロット数を減らす |
| Threads が `OAuthException` | 長期トークンの失効。上記「トークンの更新」を実行 |
| 何も投稿されない | `schedule` はデフォルトブランチでしか動かない。`main` にマージされているか確認 |
| キューが書き戻されない | Settings → Actions → Workflow permissions が Read and write になっていない |

失敗した投稿は `queue.json` に `status: "failed"` と `lastError` が残り、次の実行で3回まで自動再試行される。
成功済みのプラットフォームは再送されない（X だけ成功 → 次回は Threads だけ再試行）。

---

## 設計上の判断

- **AI で文章生成しない。** 従量課金が発生するうえ、事実でない数字や実績を投稿する事故が起きうる。
  事実バンクの組み合わせなら、投稿された文の出どころが必ず `facts.json` の中にある
- **X の署名は自前実装。** 外部パッケージを入れないので `npm install` もロックファイルも不要。
  署名は X 公式のリファレンス値で検証済み（`scripts/social/selftest.mjs`）
- **`approved` フラグと `staleAfterMinutes` は誤爆の安全弁。** これまでの運用方針は
  「投稿の公開ボタンは必ず本人が押す」だったので、完全自動に切り替えるならこの2つは残しておくこと
