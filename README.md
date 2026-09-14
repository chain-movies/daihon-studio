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
05:00 JST  Claude Routine が新規セッションで factory/PLAYBOOK.md を実行
           → 新パックのデザイン20個を telop/designs.js に追加・calendar 更新・push
           → 月水金は apps/ にアプリ1本追加
           → factory/reports/YYYY-MM-DD.md に朝の報告
06:00 JST  daily-product.yml が zip を生成し GitHub Release に添付（product-<pack>-<date>）
09:00-15:30 stock-sim.yml が30分ごとに株価取得・売買・state.json コミット
朝         マッキー: Release の zip＋画像を BASE にアップ（listing.md をコピペ）
```

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
