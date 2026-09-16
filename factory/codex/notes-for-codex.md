# Claude → Codex 引き継ぎメモ（新しい日付が上）

## 2026-09-18 向け
- `shorts-vol1` は Claude が実装済み（Release 済み）。`node factory/calendar.mjs next-design` は `business-vol1`（企業VP・セミナー）を返すはずなので、それを20デザイン実装する
- 企業VP は「落ち着き・信頼」。配色はネイビー(#0b1f3a)・チャコール(#2b2b2b)・ゴールド(#c9a227)・ホワイト・くすんだブルー(#3d6b9e)。装飾は細いライン（lineTop/lineBottom/sideBars）とアクセントバー（box.accent）まで。派手な縁取り・集中線は使わない
- 種類の例: 章タイトル（大見出し＋英字サブ「CHAPTER 01」）／見出し＋サブ見出し／ポイント番号「POINT 1」／名前・役職（tv-vol1 の business・news-name と被らない形: 下線タイプ・角丸カード）／数値実績「創業30年」「導入社数500社」／引用（社長メッセージ）／箇条書きの1行／セクション区切りの細帯／会社名ロゴ風（Zen Old Mincho）／Q&A の Q ラベル／注釈（※）／英語サブ付きミニマル／セミナー「本日のアジェンダ」／講師紹介／「まとめ」／「お問い合わせ」CTA（控えめ）／日付・会場／スライド番号風／キーワード強調（マーカー薄色）／締めの「ありがとうございました」
- フォント: Noto Sans JP 700/900、Zen Kaku Gothic New 700、Zen Old Mincho 900、Shippori Mincho B1 800、BIZ UDPGothic 700。サンプル文は企業VPらしく（「私たちが大切にしていること」「導入までの3ステップ」）。実在企業名は不可（「株式会社サンプル」）
- 9/18 は金曜なのでアプリも1本。roadmap の未着手最優先は #4「台本→SRT 字幕分割」（無料→Pro）か #5「周年記念動画ヒアリングシート」。#4 を推奨（apps/srt-splitter/。1行N文字で分割、尺は文字数比で自動配分、SRT/CSV 出力、DEMO は3分まで）。listing.md / README.txt / apps/index.html のリンクを忘れずに
- 完了後 `node factory/build_pack.mjs --pack business-vol1 --quick` が通ることを確認

## 2026-09-17 向け
- `news-vol1` は Claude が実装済み（Release 済み）。`node factory/calendar.mjs next-design` は `shorts-vol1`（縦動画専用）を返すはずなので、それを20デザイン実装する
- 縦動画パックの必須設定: 全デザインに `portraitScale: 1` を付ける。9:16 で中央に置くものは `anchor: { x: 'center', y: 'middle' }`、上部フックは `y: 'top', margin: 220`（スマホUIに隠れない位置）、下部CTAは `y: 'bottom', margin: 260`
- 種類の例: 中央ドーン（極太・3重縁取り）／上部フック「最後まで見て」／下部CTA「続きはプロフから」「保存して後で見る」／字幕バー（1行・黒半透明、BIZ UDPGothic）／ハイライトマーカー風（box underline 太め）／番号「①」ステップ表示／「結論」「NG例」「OK例」タグ／カウントダウン風 数字／引用「」／ハッシュタグ風 pill／注意書き小／Before→After／価格表示「¥」／質問「？」吹き出し／「保存必須」スタンプ風（skew + stroke）／セリフ風 手書きフォント
- フォント: Noto Sans JP 900 / Dela Gothic One / M PLUS 1p 900 / Zen Maru Gothic 900 / Yusei Magic / Mochiy Pop One。色はビビッド（黄・ピンク・シアン・白黒）で、tv-vol1 の `vlog-natural` `kids-pop` と被らないこと
- サンプル文は短く 6〜12 文字（例:「これ知らないと損」「保存して後で見る」「結論から言うと」）。実在アプリ名（TikTok/CapCut 等）はサンプル文・デザイン名に入れない（「縦動画風」まで）
- 9/17 は木曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack shorts-vol1 --quick` が通ることを確認し、contact_sheet.jpg で 9:16 のはみ出しがないか見る（--quick は 16:9 のみなので、`window.renderOne` を 1080×1920 で数枚試すとよい）

## 2026-09-16 向け
- `variety-vol1` は Claude が実装済み（Release 済み）。`node factory/calendar.mjs next-design` は `news-vol1` を返すはずなので、それを20デザイン実装する
- ニュース系は「読みやすさ」最優先: Noto Sans JP 900 / BIZ UDPGothic 700 / Zen Kaku Gothic New 900 を軸に、帯（box.type 'bar' / 'tagleft' / 'rect'）＋タグ（tag）＋サブ（sub）で構成。ネイビー(#0b2a5b)・赤(#b7001e)・黒(#111)・白の4色運用。装飾は控えめ（deco は lineTop/lineBottom/sideBars 程度）
- 種類の例: 速報／L字風の下帯／名前＋肩書き／場所・日時／記者リポート／気象警報（黄・赤）／選挙速報（当確）／株価・為替ボード／注意喚起（黄黒）／提供・協力／取材協力／再現VTR／専門家コメント／視聴者の声／続報／独自取材／ライブ中継LIVE／字幕（2行）／緊急地震速報風は作らない（誤認リスク）
- 既存の news-flash / news-name（tv-vol1）と被らないよう色・形を変える
- アプリは月水金のみ。9/16 は火曜なのでアプリ実装は不要

## 2026-09-15 向け
- 今日の pack は `variety-vol1`（バラエティ特化 20デザイン）。`telop/designs.js` の既存 `variety-tsukkomi` / `variety-odoroki` と被らない表現を優先: 集中線風の deco、爆発吹き出し（box.type 'brush' の jitter 大きめ）、3重縁取り、版ずれ、極太フォント（Dela Gothic One / Reggae One / RocknRoll One / Mochiy Pop One / Rampart One / Potta One）
- サンプル文は短い口語（例:「ウソでしょ！？」「ザワザワ…」「まさかの展開」「本人登場」「※スタッフが美味しくいただきました」）。実在番組名は不可
- 各デザインに variants を4色。黄・赤・青・緑・ピンク・白黒のどれか
- 完了後、`node factory/build_pack.mjs --pack variety-vol1 --quick` が通ることを確認
