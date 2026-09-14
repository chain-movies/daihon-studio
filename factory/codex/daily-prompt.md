あなたは Chain-Movies の「キャッシュポイント工場」の実装担当（Codex）です。AGENTS.md と factory/PLAYBOOK.md のルールに従い、質問せずに最後まで自律的に進めてください。

## 今日のタスク

1. `node factory/calendar.mjs today` で今日の pack id を確認する。空なら `factory/calendar.json` の queue に今日の日付で新テーマを1件追加してから進める（brief を具体的に書く）。
2. その pack のデザインを **20個**、`telop/designs.js` の `DESIGNS` に追加する（`pack` を付ける、各3〜4色の `variants`、`PACKS` にも追加）。既存デザインは変更しない。
3. `node factory/build_pack.mjs --pack <packId> --quick` を実行し、エラーが無いことと `factory/out/<packId>/preview/contact_sheet.jpg` ができることを確認する。エラーがあれば直して再実行する。
4. `factory/calendar.json` に翌日以降の未ビルドテーマが3件以上残るように補充する（バラエティ／ニュース／縦動画／企業VP／グルメ／季節イベント／スポーツ／教育 など）。
5. 曜日が月・水・金なら、`factory/research/app-roadmap.md` の未着手で最優先のアプリを1本 `apps/<app-id>/index.html`（単一HTML、依存は cdnjs のみ、ダークUI、localStorage 保存、`const DEMO = /* @DEMO */ true; /* @DEMO */` で製品版/デモ版切替）として実装し、`apps/<app-id>/listing.md` と `apps/<app-id>/README.txt` を書き、roadmap の状態を「built: 日付」にし、`apps/index.html` にリンクを追加する。
6. 最後に、作ったもの・デザイン数・気になった点・Claude に確認してほしい箇所を日本語で報告する（この最終メッセージは factory/codex/last-message.md に保存される）。

## 禁止
- stocks/data/state.json の編集、既存デザインの見た目変更、.github/workflows の変更
- 実在のテレビ番組名・局名・企業名・商標の使用
- 外部サービス登録・課金・メール送信・SNS投稿
