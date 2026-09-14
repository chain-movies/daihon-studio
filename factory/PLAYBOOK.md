# 日次ルーティン PLAYBOOK（Claude 自動セッション用）

このファイルは **Claude Code の Routine（毎朝 5:00 JST に新規セッション起動）が最初に読む手順書**。
人間（マッキー）はこのファイルを編集するだけで運用を変えられる。

## 0. 前提・目的

- 目的: Chain-Movies のキャッシュポイントを毎日1つ増やす。**「作って終わり」ではなく「販売できる状態の成果物＋朝の報告」まで**が1日の完了条件
- 販売先: BASE（https://commandc.base.shop/ のような形式）と BOOTH。アップロードは人間が朝に行う（3分で済むよう listing.md を必ず用意する）
- 予算: 有料 API・課金操作は一切使わない（Google Fonts・Yahoo Finance・GitHub Actions のみ）。生成AI画像/動画の有料生成も禁止
- 法務: 実在のテレビ番組名・局名・企業ロゴを商品名や説明に使わない。「〜風」「〜ジャンル」の汎用表現にする。フォントは Google Fonts（OFL）のみ
- リポジトリ: `chain-movies/daihon-studio`（GitHub Pages: https://chain-movies.github.io/daihon-studio/ ）

## 0.5 Codex との分業（重要）

- **4:00 JST: Codex**（`.github/workflows/codex-daily.yml`、`AGENTS.md` と `factory/codex/daily-prompt.md` に従う）が、その日のパック20デザインと（月水金）アプリ1本を実装して `codex: <packId> ...` というコミットで push する。最終メッセージは `factory/codex/last-message.md`
- **5:00 JST: Claude（このPLAYBOOK）** は、まず `git log --since=6.hours --oneline` と `factory/codex/last-message.md` で Codex の成果を確認する
  - Codex が実装済み → **作り直さない**。§2 の手順3（確認レンダリング→目視→修正）から始め、品質を上げることに時間を使う（文字はみ出し・帯の細さ・色の沈み・サンプル文の不自然さ・実在名の混入）。Codex が「確認してほしい」と書いた箇所を必ず見る
  - Codex が動いていない（Secrets 未設定・失敗）→ 従来どおり Claude が §2 を全部やる
- 役割の考え方: Codex＝量産（実装）、Claude＝品質・判断・報告。どちらも同じルール（実在名禁止・OFLフォント・state.json 不可）

## 1. セットアップ（毎回）

```bash
cd /home/user/daihon-studio 2>/dev/null || git clone https://github.com/chain-movies/daihon-studio /home/user/daihon-studio
cd /home/user/daihon-studio
git fetch origin
# main に factory/PLAYBOOK.md があれば main、なければ作業ブランチ
if git cat-file -e origin/main:factory/PLAYBOOK.md 2>/dev/null; then git checkout -B main origin/main; else git checkout -B claude/monetization-tool-rebuild-qp828g origin/claude/monetization-tool-rebuild-qp828g; fi
node factory/fetch_fonts.mjs        # フォントキャッシュ（初回 ~2分）
node factory/calendar.mjs list      # 商品キューの確認
```

Playwright が無い場合: `npm i -g playwright@1.56.1 && npx playwright install chromium`（環境に Chromium が既にある場合は不要）。
このセッション環境ではプロキシ経由のため、Node の fetch を使うスクリプトは `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` を付けて実行する。

## 2. 毎日: テロップパックを1つ作る（所要 30〜60分）

1. `factory/calendar.json` の queue で **date が今日以前かつ built が null** のものを対象にする。無ければ末尾の brief を参考に新しいテーマを1つ足す（date=今日）
2. `telop/designs.js` に対象 pack のデザインを **20個** 実装する（`pack: '<packId>'`、各デザイン 3〜4 の色バリアント、サンプル文は日本語で自然な番組テロップ）。`PACKS` にも名前・価格を追加（20デザインなら ¥1,980 推奨）
   - 既存 22 デザインの spec（`font / fill / strokes / shadow / extrude / glow / box / tag / sub / deco`）を組み合わせる。新しい表現が必要なら `telop/renderer.js` を拡張してよい（既存デザインの見た目を変えないこと）
   - 縦動画向けパックは `portraitScale: 1` と `anchor.y: 'middle'` を活用
3. 確認レンダリング → 目視 → 直す:
   ```bash
   node factory/build_pack.mjs --pack <packId> --quick
   # factory/out/<packId>/preview/contact_sheet.jpg を Read で見る。文字がはみ出す・帯が細すぎる・色が沈む → spec を直して再実行
   ```
4. フル生成して zip ができることを確認: `node factory/build_pack.mjs --pack <packId>`
5. `factory/calendar.json` に翌日以降のテーマが **3件以上** 残るよう補充（brief を具体的に。売れ筋: バラエティ／ニュース／縦動画／企業VP／グルメ／季節イベント（年末年始・ハロウィン・卒業）／スポーツ／教育）
6. コミット & push（main）。push により `.github/workflows/daily-product.yml` が Release `product-<packId>-<date>` を作り、zip・トップ画像・listing.md を添付する

## 3. 毎日: 株シミュレーターの一言コメント（5分）

- `stocks/data/report.md` を読み、`stocks/data/commentary.md` の先頭に日付付きで 3〜5 行の所感を追記（何を買った/売った/なぜ、戦略の弱点、明日の注目）
- **`stocks/data/state.json` は編集しない**（Actions が管理）。戦略パラメータを変えたい時は `stocks/config.json` を変更し、理由をコミットメッセージに書く。元本リセットはしない

## 4. 月・水・金: 市場リサーチ → アプリを1本作る（60〜90分）

1. `factory/research/app-roadmap.md` を読む。**未着手で優先度が最上位のアプリ**を1本選ぶ
2. WebSearch で競合・相場を 3〜5 件確認し、`factory/research/YYYY-MM-DD-<topic>.md` に要点（価格帯・差別化・想定顧客）を 20 行以内で残す
3. `apps/<app-id>/index.html` として **単一HTML（依存は cdnjs のみ）** で実装。`telop/index.html` と同じ流儀（ダークUI、localStorage 保存、DEMO フラグで製品版/デモ版切替、書き出しは PNG/CSV/ZIP など「持ち帰れる成果物」）
4. `apps/<app-id>/listing.md`（商品名・価格・説明・タグ）と `apps/<app-id>/README.txt`（使い方）を書き、`zip -r factory/out/<app-id>_<date>.zip apps/<app-id>` が作れることを確認
5. roadmap に「built: 日付」を記入し、リサーチで見つけた新候補を 1〜2 件追加
6. Pages にデモ版が並ぶよう `apps/index.html`（一覧ページ）にリンクを追加

## 4.5 Codex への引き継ぎ

- 翌日 Codex にやってほしい具体的な指示があれば `factory/codex/notes-for-codex.md` に箇条書きで残す（Codex は AGENTS.md 経由で読む）。逆に Codex からの「確認してほしい箇所」は `factory/codex/last-message.md` にある
- Codex の実装に繰り返し同じ問題が出るなら、`AGENTS.md` のルールに1行追加して再発を止める（プロンプトを増やすより効く）

## 5. 朝の報告（必須・最後に）

`factory/reports/YYYY-MM-DD.md` を作り、push する。内容:

```
# 本日の成果 YYYY-MM-DD
## 作ったもの
- テロップパック: <名前>（<n>デザイン / 実装: Codex or Claude / Release: https://github.com/chain-movies/daihon-studio/releases/tag/product-<packId>-<date>）
- アプリ: <名前>（apps/<id>/、デモ: https://chain-movies.github.io/daihon-studio/apps/<id>/）※月水金
## マッキーがやること（3分）
1. Release の zip とトップ画像を BASE にアップロード（listing.md の文面をコピペ）
2. …
## 株シミュ
- 評価額 / 損益 / 今日の売買 1行
## 気づき・提案（率直に）
- 売れ行き・改善案・やめるべきこと
```

セッション最後のメッセージにも同じ内容を要約して書く（本人はそこを読む）。

## 6. やらないこと

- メール送信・SNS投稿・BASE への自動出品（本人が行う）
- 有料 API 呼び出し、外部サービスへの登録
- `stocks/data/state.json` の手編集、既存デザインの見た目変更、既存 Release の削除
- 実在番組・ブランド名の使用
