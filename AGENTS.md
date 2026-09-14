# AGENTS.md — Codex 用の作業ガイド

このリポジトリは Chain-Movies株式会社の「キャッシュポイント工場」。**Codex は毎朝 4:00 JST に GitHub Actions（`.github/workflows/codex-daily.yml`）で起動し、その日の商品（テロップパック／アプリ）を実装する。**
5:00 JST に Claude が起動して品質確認・修正・朝の報告を行う。人間（マッキー）は朝に BASE へアップロードするだけ。

詳細な手順は `factory/PLAYBOOK.md`。ここには Codex が守るべき要点だけを書く。

## リポジトリの地図

| パス | 役割 |
|---|---|
| `telop/designs.js` | テロップデザイン定義（`DESIGNS` 配列と `PACKS`）。**毎日ここに20デザイン追加するのが主な仕事** |
| `telop/renderer.js` | spec → Canvas 描画。新しい表現が必要な時だけ拡張（既存デザインの見た目を変えない） |
| `telop/index.html` | 購入者向けテロップメーカー（単一HTML） |
| `factory/calendar.json` | 商品キュー。`date` 到来かつ `built: null` のものが「今日の商品」 |
| `factory/build_pack.mjs` | パック生成（Playwright）。`--quick` で確認用 |
| `factory/research/app-roadmap.md` | アプリ候補。月水金は最優先の1本を `apps/<id>/index.html` に実装 |
| `stocks/` | 株シミュレーター。**`stocks/data/state.json` は触らない** |
| `factory/codex/` | Codex の起動プロンプトと最終メッセージ |

## 今日の仕事の決め方

```bash
node factory/calendar.mjs today   # → 今日ビルドすべき pack id（空なら calendar に追加してから）
node factory/calendar.mjs list
```

## デザイン実装のルール

- 1パック = 20デザイン、各デザインに `variants` 3〜4色。`pack: '<packId>'` を必ず付け、`PACKS[packId] = { name, short, price }` を追加（20デザインなら price 1980）
- spec のキー: `font / lineHeight / fill / strokes / shadow / extrude / glow / box / tag / sub / deco / anchor / portraitScale / align`。既存22デザインを手本にする
- フォントは `telop/designs.js` の `FONTS` に定義済みのものだけ（Google Fonts / SIL OFL）。新フォントを足す時は `FONTS` に google/fonts リポジトリのパスも追加する
- サンプル文は自然な日本語のテロップ（12〜18文字が目安）。実在のテレビ番組名・局名・企業名・商標は使わない（「〜風」までにする）
- 縦動画パックは `portraitScale: 1` と `anchor: { y: 'middle' }` を活用

## 検証（必須）

```bash
node factory/fetch_fonts.mjs                       # フォントキャッシュ（Actions では事前に実行済み）
node factory/build_pack.mjs --pack <packId> --quick
```

- エラーなく終わり、`factory/out/<packId>/preview/contact_sheet.jpg` が生成されること
- `node -e "require('./telop/designs.js')"` が通ること（構文チェック）
- 20デザイン揃っているか: `node -e "const d=require('./telop/designs.js');console.log(d.DESIGNS.filter(x=>x.pack==='<packId>').length)"`

## やってはいけないこと

- `stocks/data/state.json`、既存デザインの見た目、既存 Release、`.github/workflows/*` の変更
- 外部サービスへの登録、課金、メール送信、SNS投稿
- `factory/calendar.json` の `built` を手で書く（Actions が入れる）

## Claude からの引き継ぎ

`factory/codex/notes-for-codex.md` があれば最初に読み、その指示を今日のタスクに含める。

## 仕上げ

- 変更は Actions 側が `codex: <packId>` としてコミット・push する。Codex 自身は git commit しなくてよい（してもよい）
- 最後のメッセージに「作ったパック名／デザイン数／気になった点／Claude に確認してほしい箇所」を日本語で書く。`factory/codex/last-message.md` に保存される
