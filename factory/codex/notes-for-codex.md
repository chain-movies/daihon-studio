# Claude → Codex 引き継ぎメモ（新しい日付が上）

## 2026-09-20 向け
- `kids-vol1`（9/20 分）は Claude が 9/19 に先行実装済み。`node factory/calendar.mjs next-design` は `sports-vol1`（スポーツ中継・速報）を返すはずなので、それを20デザイン実装する
- スポーツは「スピード感・対戦・記録」。フォント: Noto Sans JP 900 / Dela Gothic One / M PLUS 1p 900 / Train One。skew（斜め帯）と font.skew（斜体）、SILVER/GOLD グラデ、赤青の対戦カラー（#e60012 vs #0050c8）。tv-vol1 の `sports`（速報）と被らない形にする
- 種類の例: スコアボード「3 - 1」（tag でチーム略称）／選手名＋背番号（tag '10'）／速報「ゴール！」バースト／ハイライト「HIGHLIGHT」英字帯／勝利「WIN」・敗北「LOSE」（tag text を variant で）／記録更新「自己ベスト更新」／タイム表示「9.98」大数字／前半・後半「前半 23分」／対戦カード「A vs B」（deco sideBars）／順位「1位」メダル風（GOLD/SILVER/BRONZE variants）／実況風ツッコミ「決まった！」／MVP／延長戦／逆転／解説コメント／会場・日時／天候「気温28℃」／連勝「5連勝中」／応援「がんばれ！」／リプレイ「REPLAY」
- 実在チーム名・大会名・選手名は不可（「〇〇FC」「山田 太郎」）
- 9/20 は日曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack sports-vol1 --quick` で contact_sheet を確認

## 2026-09-19 向け（更新: 9/18 午前に gourmet-vol1 を先行実装済み）
- `gourmet-vol1` は Claude が 9/18 に実装済み（20デザイン・quick/full ビルド確認済み）。9/19 の Release は Actions が自動で作る。`node factory/calendar.mjs next-design` は `kids-vol1`（教育・子ども向けポップ）を返すはずなので、それを20デザイン実装する
- kids は「丸ゴシック・パステル・ドット・ステッカー風」。フォント: Zen Maru Gothic 900 / Mochiy Pop One / Hachi Maru Pop / Kiwi Maru / M PLUS 1p 900 / Potta One。色: パステル（#ffd6e0 #cde7ff #fff3b0 #d4f5d0 #e9d5ff）＋濃い縁取り（#3a3a3a / #5a3e2b）。tv-vol1 の `kids-pop`（レインボー＋白黒縁）と被らない表現に
- 種類の例: クイズ「もんだい」タグ／正解○・不正解×（tag text を variant で差し替え）／ひらがな見出し（Hachi Maru Pop）／「やってみよう！」／「ポイント」ふせん風（box round＋shadow ハード）／「おぼえておこう」／数字「①②③」（s-step と違う形: 星や丸）／「なまえ」記名欄風／「きょうのテーマ」ヘッダー／「せいかい！」バースト（burst 小さめ・パステル）／「おしい！」／レベル表示「レベル1」ピル／「まめちしき」吹き出し（speech）／「おわり」／英語「Let's try!」／せんせいのコメント（手書き）／「10びょう」カウント／「まとめ」／注意「おうちのひとといっしょに」／ハートやキラキラ deco（sparkle）
- サンプル文はひらがな多め・6〜12 文字。実在の教材・番組・キャラ名は不可
- 9/19 は土曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack kids-vol1 --quick` で contact_sheet を確認

## 2026-09-19 向け
- `business-vol1` と `apps/srt-splitter` は Claude が実装済み。`node factory/calendar.mjs next-design` は `gourmet-vol1`（グルメ・旅・Vlog）を返すはずなので、それを20デザイン実装する
- グルメ・旅は「暖色・手書き・和」。フォント: Yuji Syuku（筆）／Zen Antique Soft／Kaisei Decol／Klee One／Yusei Magic／Zen Maru Gothic 900／Shippori Mincho B1。色: 朱(#c8412b)・柿(#e8894a)・抹茶(#6b8e3d)・墨(#2b2b2b)・生成り(#f3e9d2)・金
- tv-vol1 の `gourmet-brush`（筆文字・朱帯）`travel`（ゆる旅）`vlog-natural` と被らない表現にする（帯の形・フォントを変える）
- 種類の例: 店名＋ジャンル（box tagleft 生成り＋朱アクセント）／料理名＋価格（sub 'right' で ¥ 表示）／「絶品」「名物」スタンプ（round 二重枠・朱）／地名タグ（pill 抹茶）／ロケ日・天気（小・右上）／「営業時間」情報バー／筆文字大見出し（Yuji Syuku＋和紙風 box）／手書きコメント（Klee One＋白フチ）／★評価（sample '★★★★☆ 4.3'）／「ここでしか食べられない」煽り／旅の目次「1日目」（skew 柿）／移動手段アイコン風「電車で30分」（pill）／グルメの温度感「アツアツ」（Mochiy Pop One＋朱グラデ）／「おすすめ」リボン（box ribbon）／注釈「※価格は税込」／お土産「お持ち帰りOK」／季節「秋限定」（紅葉色 grad）／締め「ごちそうさまでした」（明朝）／Vlog タイムスタンプ「AM 9:00」／「行ってみた」ハッシュタグ風
- サンプル文は 6〜14 文字、実在店名・チェーン名は不可（「〇〇食堂」「サンプル亭」）
- 9/19 は土曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack gourmet-vol1 --quick` で contact_sheet を確認

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
