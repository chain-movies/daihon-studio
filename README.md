# daihon-studio — Chain-Movies キャッシュポイント工場

GitHub Pages: https://chain-movies.github.io/daihon-studio/

| パス | 何 | 公開URL（main にマージ後） |
|---|---|---|
| `index.html` | ショートドラマ台本スタジオ（既存） | `/` |
| `telop/` | **テロップメーカー**（デモ版）＋デザイン定義＋共通レンダラー | `/telop/` |
| `stocks/` | **仮想トレード30万円チャレンジ** ダッシュボード＋エンジン | `/stocks/` |
| `factory/` | 商品生成パイプライン（パック生成・カレンダー・PLAYBOOK・リサーチ） | — |
| `.github/workflows/` | `daily-product.yml`（毎朝パック生成→Release）／`stock-sim.yml`（平日30分ごと売買） | — |

## 毎日どう回るか

```
04:00 JST  Codex（codex-daily.yml）が新パックのデザイン20個を実装して push（OPENAI_API_KEY 設定時）
05:00 JST  Claude Routine が新規セッションで factory/PLAYBOOK.md を実行
           → Codex の成果を目視確認・修正（Codex 未実行なら自分で実装）・calendar 更新・push
           → 月水金は apps/ にアプリ1本追加
           → factory/reports/YYYY-MM-DD.md に朝の報告
06:00 JST  daily-product.yml が zip を生成し GitHub Release に添付（product-<pack>-<date>）
09:00-15:30 stock-sim.yml が30分ごとに株価取得・売買・state.json コミット
朝         マッキー: Release の zip＋画像を BASE にアップ（listing.md をコピペ）
```

## Codex との連携（実装は Codex、品質と報告は Claude）

```
04:00 JST  codex-daily.yml … Codex が AGENTS.md / factory/codex/daily-prompt.md に従い
           その日のパック20デザイン（月水金はアプリも）を実装 → 検証 → push（コミット "codex: ..."）
05:00 JST  Claude Routine … Codex の成果を目視確認・修正 → 朝の報告
```

有効化に必要なのは1つだけ: GitHub リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で `OPENAI_API_KEY` を登録する（OpenAI Platform の API キー。ChatGPT のログインでは動かない）。未登録の間は Codex ステップをスキップし、Claude が従来どおり全部やる。

- 手動で任せる: Actions → codex-daily → Run workflow の `task` に指示を書く
- スマホから任せる: Issue を作って `codex` ラベルを付ける（本文がタスクになり、結果が Issue にコメントされる）
- Codex に翌日やってほしいことは `factory/codex/notes-for-codex.md` に書く
- 費用は OpenAI の API 従量課金（1回の実行で数十〜数百円規模）。OpenAI Platform の Usage limits で月額上限を必ず設定する
- 参考: https://github.com/openai/codex-action

## 手元で動かす

```bash
node factory/fetch_fonts.mjs                         # フォントキャッシュ（初回）
node factory/build_pack.mjs --pack tv-vol1 --quick   # 確認用（16:9 のみ）
node factory/build_pack.mjs --pack tv-vol1           # フル生成 → factory/out/tv-vol1_<date>.zip
node stocks/engine.mjs --force                       # 株シミュを1回実行（市場時間外でも売買判定）
node factory/calendar.mjs list                       # 商品キュー
```

Playwright（Chromium）と Node 22 が必要。zip は `factory/out/`（git 管理外）。

## 株シミュレーターの操作

- 戦略・元本・単元は `stocks/config.json`
- 手動売買: `stocks/manual_orders.json` に `[{"action":"buy","symbol":"9432","shares":100,"note":"理由"}]` → 次の実行で約定
- リセット: Actions の stock-sim を `reset=true` で手動実行

## 販売のときの注意

- 商品名・説明に実在の番組名・局名は使わない（「バラエティ風」「ニュース速報風」まで）
- フォントは Google Fonts（SIL OFL）。画像化したものを販売し、フォントファイルは同梱しない
- 購入者向けアプリ（zip 内の テロップメーカー）は透かしなしの製品版。Pages 上の `/telop/` はデモ版（SAMPLE 透かし・一括3行まで）
