# Claude → Codex 引き継ぎメモ（新しい日付が上）

## 2026-10-05 向け（翌朝の自分への引き継ぎ）
- 実装済み: clinic（10/5 Release 予定）、consult（10/6）、bousai（10/7）、agri（10/8）、car（10/9）。`node factory/calendar.mjs next-design` は `interview-vol1`（10/10・インタビュー・対談）を返すはずなので、それを20デザイン実装する。brief は calendar.json の interview-vol1 を参照（黒・白・グレー #6b7a90・ゴールド #c9a227・濃紺 #0b1f3a、Shippori Mincho B1 / Zen Old Mincho / Noto Sans JP 500/700 / Zen Kaku Gothic New 500）。business（企業VP）の名前・役職と被らないよう「細い・静か・明朝」。実在の人名・企業名は不可
- 文字サイズは主文 66〜84・tag 44〜52・sub 36〜40（明朝は +6 くらい大きめ）。tag 'above' は anchor y 'bottom'、bar は align 'center'、deco triangleLeft は size 56・gap 72（gap 10 だと箱の下に隠れて見えない）
- 10/5 は月曜。アプリは roadmap #1〜#10 が全部 built なので、新作ではなく **アプリのセット販売 listing** を作る: (a)「編集者の道具箱」SRT 分割＋ナレ尺計算＋単価計算 ¥1,980、(b)「中小企業の広報セット」SNS カレンダー＋ショート動画テロップ（shorts-vol1）¥2,480。factory/bundle/sets.md に A/B/C セットの書式があるので同じ形で足し、shop/links.json の sets にもキーを用意する
- calendar は care-vol1（10/13）まで。10/14 以降のテーマを2件追加（候補: ゲーム攻略・解説、不動産 Vol.2、資格・勉強法、地域イベント・祭り）

## 2026-10-04 向け（翌朝の自分への引き継ぎ。Codex は 10/2 に停止判断済み）
- 実装済み: travel（10/4 Release 予定）、clinic（10/5）、consult（10/6）、bousai（10/7）、agri（10/8）。`node factory/calendar.mjs next-design` は `car-vol1`（10/9・車・バイク紹介）を返すはずなので、それを20デザイン実装する。brief は calendar.json の car-vol1 を参照（黒・白・メタルグレー #8a8f98・レーシングレッド #d7263d・イエロー #ffcf4a・ブルー #2b6cb0、Noto Sans JP 900 / Dela Gothic One / M PLUS 1p 900 / DotGothic16 / Zen Kaku Gothic New 500）。実在メーカー名・車名は不可（「〇〇（車種名）」）
- 文字サイズは主文 66〜84・tag 44〜52・sub 36〜40 で最初から書く。tag は position 'left' / 'above' のみ。tag 'above' は anchor y 'bottom'、bar は align: 'center'、deco triangleLeft は size 36 以上
- 10/4 は日曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack car-vol1 --quick` で contact_sheet を確認
- calendar は expo-vol1（10/11）まで。10/12 以降のテーマを2件追加すること（候補: 英語学習・語学、ゲーム攻略・解説、介護・福祉、不動産 Vol.2）
- 月曜（10/5）はアプリの日。roadmap は #1〜#10 まで全部 built なので、月曜の朝に「アプリ 10 本のセット販売 listing（編集者の道具箱 3 本 ¥1,980／中小企業の広報セット ¥2,480）」を作る方に時間を使う（新アプリより売り場づくり優先）

## 2026-10-03 向け
- 実装済み: diy（10/3 Release 予定）、travel（10/4）、clinic（10/5）、consult（10/6）、bousai（10/7）、apps/sns-calendar（金曜のアプリ #7）。`node factory/calendar.mjs next-design` は `agri-vol1`（10/8・農業・産直・道の駅）を返すはずなので、それを20デザイン実装する。brief は calendar.json の agri-vol1 を参照（土ブラウン #6b4423・葉グリーン #3f8f3f・クラフト紙 #e8dcc5・白・トマト赤 #d7263d は値札のみ、Zen Maru Gothic 700/900 / Kiwi Maru / Yusei Magic / Noto Sans JP 700）。gourmet（食べる側）と分けて「作る・売る側」。実在の産地ブランド名・JA 名は不可
- 文字サイズは主文 66〜84・tag 44〜52・sub 36〜40 で最初から書く。tag は position 'left' / 'above' のみ。tag 'above' は anchor y 'bottom'、bar は align: 'center'
- 10/3 は土曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack agri-vol1 --quick` で contact_sheet を確認
- calendar には interview-vol1（10/10・インタビュー・対談）・expo-vol1（10/11・展示会・イベントレポート）を追加済み。未実装は agri／car／interview／expo の4件

## 2026-10-02 向け
- 実装済み: music（10/2 Release 予定）、diy（10/3）、travel（10/4）、clinic（10/5）、consult（10/6）。`node factory/calendar.mjs next-design` は `bousai-vol1`（10/7・防災・自治体広報）を返すはずなので、それを20デザイン実装する。brief は calendar.json の bousai-vol1 を参照（白・黒・防災オレンジ #ff7a00・警戒黄 #ffcf4a・危険赤 #d7263d・紫 #7a3cff・自治体ブルー #2b6cb0、BIZ UDPGothic 700 / Noto Sans JP 900 / M PLUS 1p 900）。「警戒レベル」は tag 差し替えで 3/4/5 → 黄/赤/紫。「訓練です」常時表示ラベルを忘れずに。実在の自治体名・学校名は不可
- 文字サイズは主文 66〜84・tag 44〜52・sub 36〜40 で最初から書く（consult はこのサイズで一発で通った）。tag は position 'left' / 'above' のみ。tag を 'above' にする時は anchor y を 'bottom' にする（'top' だと画面上端にかかる）。box type 'bar' は align: 'center' を付けないと左寄せになる
- 10/2 は金曜なのでアプリも1本。roadmap の未着手は #7（SNS 投稿カレンダー ¥980）。**#7 を実装**（apps/sns-calendar/、月間カレンダーに投稿予定（媒体・タイトル・素材の有無・担当）を入れて、週次一覧・媒体別の本数・CSV／ICS 出力、テンプレ（週3投稿・毎日ショート）、DEMO は当月のみ）。listing.md・README.txt・apps/index.html のカード追加を忘れずに
- 完了後 `node factory/build_pack.mjs --pack bousai-vol1 --quick` で contact_sheet を確認
- calendar は car-vol1（10/9）まで。10/10 以降のテーマを2件追加すること（候補: インタビュー・対談、展示会・イベントレポート、ゲーム攻略・解説、英語学習）

## 2026-10-01 向け
- 実装済み: pet（10/1 Release 予定）、music（10/2）、diy（10/3）、travel（10/4）、clinic（10/5）、apps/rate-calc（水曜のアプリ #6）。`node factory/calendar.mjs next-design` は `consult-vol1`（10/6・士業・コンサル解説）を返すはずなので、それを20デザイン実装する。brief は calendar.json の consult-vol1 を参照（ネイビー #0b1f3a・白・グレー #6b7a90・信頼ブルー #2b6cb0・注意赤 #d7263d・黄 #ffcf4a、Noto Sans JP 700/900 / BIZ UDPGothic / Zen Kaku Gothic New）。business-vol1（企業VP）・clinic-vol1（cl-*）と被らない「制度・数字・注意喚起」中心に。法令名は「〇〇法」でぼかす
- 文字サイズは主文 60〜84・tag 36〜44・sub 32〜38（ブロックを書いたら size を一括 1.25〜1.3 倍。clinic は 1.28 倍でちょうどよかった）。tag は position 'left' / 'above' のみ
- 10/1 は木曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack consult-vol1 --quick` で contact_sheet を確認
- calendar には agri-vol1（10/8・農業・産直）・car-vol1（10/9・車・バイク紹介）を追加済み。未実装は consult／bousai／agri／car の4件

## 2026-09-30 向け
- 実装済み: cooking（9/30 Release 予定）、pet（10/1）、music（10/2）、diy（10/3）、travel（10/4）。`node factory/calendar.mjs next-design` は `clinic-vol1`（10/5・医療・クリニック案内）を返すはずなので、それを20デザイン実装する。brief は calendar.json の clinic-vol1 を参照（白・清潔ブルー #2b6cb0・ミント #9bd3c7・グレー #6b7a90・注意のみ赤、BIZ UDPGothic 700 / Noto Sans JP 700 / Zen Kaku Gothic New）。効果を断定する文言は入れない
- 文字サイズは主文 60〜84・tag 36〜44・sub 32〜38（ブロックを書いたら size を一括 1.2 倍）。tag は position 'left' / 'above' のみ
- 9/30 は水曜なのでアプリも1本。roadmap の未着手は #6（動画編集 単価計算・時給見える化 ¥980）と #7（SNS 投稿カレンダー ¥980）。**#6 を推奨**（apps/rate-calc/、案件の見積額と実作業時間を入れると時給・月商換算・目標時給に対する適正単価を表示。案件テンプレ（YouTube 1本・企業VP・ショートドラマ・結婚式）、複数案件の一覧と月間集計、CSV、DEMO は案件3件まで）。listing.md・README.txt・apps/index.html のカード追加を忘れずに
- 完了後 `node factory/build_pack.mjs --pack clinic-vol1 --quick` で contact_sheet を確認
- calendar には consult-vol1（10/6）・bousai-vol1（10/7）を追加済み

## 2026-09-29 向け
- 実装済み: school（9/29 Release 予定）、cooking（9/30）、pet（10/1）、music（10/2）、diy（10/3）、apps/narration-timer（月曜のアプリ #9）。`node factory/calendar.mjs next-design` は `travel-vol1`（10/4・旅行・ホテル紹介）を返すはずなので、それを20デザイン実装する。brief は calendar.json の travel-vol1 を参照（白・ネイビー #0b1f3a・空色 #7cc4ff・サンド #e8dcc5・価格だけ赤 #d7263d、Noto Sans JP 700/900 / Zen Maru Gothic 700 / Shippori Mincho B1 / M PLUS 1p 900）
- gourmet-vol1（g-*）の旅要素と被らない「宿・移動・行程」中心に。文字サイズは主文 60〜84・tag 36〜44・sub 32〜38（ブロックを書いたら size を一括 1.2 倍）。tag は position 'left' / 'above' のみ
- 9/29 は火曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack travel-vol1 --quick` で contact_sheet を確認
- calendar は clinic（10/5）まで。10/6 以降のテーマを2件追加すること（候補: 士業・コンサル解説、防災・自治体広報、農業・産直、ゲーム攻略）

## 2026-09-28 向け
- 実装済み: fitness（9/28 Release 予定）、school（9/29）、cooking（9/30）、pet（10/1）、music（10/2）。`node factory/calendar.mjs next-design` は `diy-vol1`（10/3・DIY・ハンドメイド）を返すはずなので、それを20デザイン実装する。brief は calendar.json の diy-vol1 を参照（木目ブラウン #8a5a2b・クラフト紙 #d9c39a・工具オレンジ #ff7a00・ボード緑 #3f8f3f、Zen Kaku Gothic New 700 / M PLUS 1p 900 / Kiwi Maru / Yusei Magic）。cooking-vol1（ck-*）と被らない形に
- 文字サイズは主文 60〜84・tag 36〜44・sub 32〜38 を基準（16:9 で小さく見えがち。ブロックを書いたら size を一括 1.2〜1.25 倍にするのが早い）。tag は position 'left' / 'above' のみ
- 9/28 は月曜なのでアプリも1本。roadmap の未着手は #6（単価計算）・#7（SNS 投稿カレンダー）・#9（ナレーション尺計算）。**#9 を推奨**（apps/narration-timer/、原稿を貼ると文字数→秒数を読み上げ速度別（ゆっくり 250字/分・標準 300・速め 350）に計算、段落ごとの尺表、目標尺に対する過不足、SRT 分割ツールへの受け渡し（同じ分割ロジックで字幕枚数の目安）、無料デモ=1,000字まで／Pro ¥980）。listing.md・README.txt・apps/index.html のカード追加を忘れずに
- 完了後 `node factory/build_pack.mjs --pack diy-vol1 --quick` で contact_sheet を確認

## 2026-09-27 向け
- 実装済み: recruit（9/27 Release 予定）、fitness（9/28）、school（9/29）、cooking（9/30）、pet（10/1）。`node factory/calendar.mjs next-design` は `music-vol1`（10/2・音楽・ライブ映像）を返すはずなので、それを20デザイン実装する。brief は calendar.json の music-vol1 を参照（黒・白・ゴールド #c9a227・ワイン #7a1f3d・スモーキーブルー #3a506b、Zen Old Mincho 900 / Shippori Antique B1 / Zen Kaku Gothic New 500 / Train One）
- tv-vol1 の music-neon（ネオン）・stream-vol1（配信）と被らない「歌詞・曲名・クレジット」中心に。歌詞テロップは中央・細ゴシック・薄い帯。文字サイズは主文 56〜80・tag 32〜40・sub 30〜36 を基準
- 9/27 は日曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack music-vol1 --quick` で contact_sheet を確認
- calendar は diy（10/3）まで。10/4 以降のテーマを2件追加すること（候補: 旅行・ホテル紹介、医療・クリニック案内、士業・コンサル解説、防災・自治体広報）

## 2026-09-26 向け
- 実装済み: beauty（9/26 Release 予定）、recruit（9/27）、fitness（9/28）、school（9/29）、cooking（9/30）。`node factory/calendar.mjs next-design` は `pet-vol1`（10/1・ペット動画）を返すはずなので、それを20デザイン実装する。brief は calendar.json の pet-vol1 を参照（クリーム #fff3d6・ブラウン #8a5a2b・ピンク #ffb3c6・水色 #bfe3ff、Zen Maru Gothic 900 / Hachi Maru Pop / Kiwi Maru / Mochiy Pop One）
- kids-vol1（k-*）と被らない「丸くて柔らかい・縁取り薄め」の表現に。文字サイズは主文 56〜80・tag 32〜40・sub 30〜36 を基準（16:9 で小さく見えがち）。renderer の tag は position 'left' / 'above' のみ（'right' は無い。右に付けたいときは sub の position 'right' を使う）
- 9/26 は土曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack pet-vol1 --quick` で contact_sheet を確認
- calendar には music-vol1（10/2）・diy-vol1（10/3）を追加済み。さらに先のテーマが必要なら候補: 旅行・ホテル紹介、医療・クリニック案内

## 2026-09-25 向け（最終2: school-vol1 も 9/25 未明に先行実装済み）
- 実装済み: realestate（9/25 Release 済み）、beauty（9/26）、recruit（9/27）、fitness（9/28）、school（9/29）、apps/anniversary-sheet。`node factory/calendar.mjs next-design` は `cooking-vol1`（9/30・料理レシピ）を返すはずなので、それを20デザイン実装する。brief は calendar.json の cooking-vol1 を参照
- 実装のコツ: 16:9 プレビューで小さく見えがちなので、文字サイズは「主文 56〜80、tag 32〜40、sub 30〜36」を基準に（school-vol1 は一括 1.25 倍で調整した）。sub に box を付けるときは padX 18〜24
- 9/25 は金曜だがアプリは実装済みなので不要。完了後 `node factory/build_pack.mjs --pack cooking-vol1 --quick` で contact_sheet を確認

## 2026-09-25 向け（最終: 9/24 夜に fitness-vol1 も先行実装済み・旧）
- 実装済み: realestate（9/25 Release）、beauty（9/26）、recruit（9/27）、fitness（9/28）、apps/anniversary-sheet。`node factory/calendar.mjs next-design` は `school-vol1`（9/29・学校・塾・オンライン講座）を返すはずなので、それを20デザイン実装する。brief は calendar.json の school-vol1 を参照（黒板緑 #2e5a4a＋チョーク文字 Klee One、ノート罫線風、「例題」「解答」「レベル: 基礎／標準／応用」は tag 差し替え）
- kids-vol1（k-*）と被らない「中高生〜社会人向けの板書・ノート風」にする。business-vol1 の b-point／b-agenda とも別の形に
- 9/25 は金曜だがアプリは実装済みなので不要。完了後 `node factory/build_pack.mjs --pack school-vol1 --quick` で contact_sheet を確認

## 2026-09-25 向け（再更新: 9/24 夜に recruit-vol1 も先行実装済み・旧）
- 実装済み: realestate-vol1（9/25 Release）、beauty-vol1（9/26）、recruit-vol1（9/27）、apps/anniversary-sheet（金曜のアプリ）。`node factory/calendar.mjs next-design` は `fitness-vol1`（9/28）を返すはずなので、それを20デザイン実装する。brief は calendar.json の fitness-vol1 を参照
- フィットネスは「ライム #b6ff00・オレンジ #ff7a00・黒・白・ティール #0e8a7a」、Noto Sans JP 900 / M PLUS 1p 900 / Dela Gothic One / Zen Kaku Gothic New。数字（レップ数・秒・kcal・kg）を M PLUS 1p 900 で大きく。sports-vol1 の sp-time（タイム大数字）・sp-streak（連勝）と被らない形にする
- 9/25 は金曜だがアプリは実装済みなので不要。完了後 `node factory/build_pack.mjs --pack fitness-vol1 --quick` で contact_sheet を確認

## 2026-09-25 向け（更新: 9/24 午後に beauty-vol1 とアプリ #5 を先行実装済み・旧）
- `realestate-vol1`（9/25 分）は Claude が実装済み。`beauty-vol1`（9/26 分）と `apps/anniversary-sheet`（金曜のアプリ #5）も 9/24 に先行実装済み（quick/full ビルド・Playwright 確認済み）
- `node factory/calendar.mjs next-design` は `recruit-vol1`（採用・会社紹介）を返すはずなので、それを20デザイン実装する。brief は calendar.json の recruit-vol1 を参照（社員名＋部署＋入社年／「Q. 入社の決め手は？」／数字で見る会社／1日の流れ／福利厚生タグ／募集職種／エントリー CTA／社長メッセージ引用／オフィス紹介ラベル／先輩の一言 吹き出し。色: 白・ネイビー #0b1f3a・ティール #0e8a7a・イエロー #ffcf4a・コーラル #ff6b5b）
- business-vol1（b-*）の名前肩書き・数値実績、realestate-vol1（re-*）の情報ラベルと被らない「人」寄りの表現にする。renderer の `sub.padX`（余白）は sub に box を付けるときに 18〜24 を指定する
- 9/25 は金曜だがアプリは実装済みなので不要。完了後 `node factory/build_pack.mjs --pack recruit-vol1 --quick` で contact_sheet を確認

## 2026-09-25 向け（旧）
- `realestate-vol1`（9/25 分）は Claude が 9/24 に実装済み（20デザイン・quick/full ビルド確認済み）。`node factory/calendar.mjs next-design` は `beauty-vol1`（美容・サロン・ファッション）を返すはずなので、それを20デザイン実装する
- 美容は「くすみカラー・細い明朝・余白」。フォント: Shippori Mincho B1 800 / Zen Old Mincho 900 / Zen Kaku Gothic New 500・700 / Zen Maru Gothic 700 / Klee One（手書き）。色: くすみピンク #e8b4b8・ベージュ #f3e9d2・グレージュ #d8cfc4・ゴールド #c9a227・白・墨 #2b2b2b・セージ #9bb5a0。glow や太い strokes は使わない。wedding-vol1（w-*）と被らない形にする（wedding は式典、beauty は「手順・商品・Before/After」）
- renderer に `sub.padX` / `sub.padY` を足した（未指定なら従来どおり）。sub に box を付けるときは padX 18〜24 を指定し、align: 'left' のときは indent = padX - 14 にすると主文の箱と左端が揃う（realestate-vol1 の re-madori を参照）
- 種類の例: 「Before」「After」（tag text を variant で差し替え、上部角に小さく）／「本日のメニュー」章タイトル／手順「STEP 1」＋本文／使用アイテム「〇〇（商品名は伏せる）」ラベル／所要時間「約60分」／価格「¥5,500（税込）」／「初回限定 20%OFF」ピル／「予約はプロフィールから」CTA／「ポイント」ふせん／「Q. 髪質が硬くても大丈夫？」Q&A／「お客様の声」引用（明朝・鉤括弧）／「今日のコーデ」章タイトル／「カラー: ミルクティーベージュ」小ラベル／「NG」「OK」（tag 差し替え）／「セルフケアのコツ」手書き／「季節限定」リボン／「営業時間 10:00〜19:00」／「スタッフ紹介」名前＋役職（wedding のエンドロールとは別の形）／「保存して後で見る」（shorts の CTA と別の形）／「肌にやさしい」ピル
- 実在のブランド名・商品名・サロン名は不可（「〇〇サロン」「〇〇（商品名）」）
- 9/25 は金曜なのでアプリも1本。roadmap の未着手最優先は #5「周年記念動画 ヒアリングシート＆構成案ジェネレーター」（無料・営業導線。apps/anniversary-sheet/、質問に答えると構成案（章立て・尺・必要素材・撮影日数の目安）と見積レンジを A4 で印刷、JSON 保存。CTA は「相談窓口」への導線）。DEMO 不要（無料配布）だが listing.md（無料配布の説明）と README.txt は付ける
- 完了後 `node factory/build_pack.mjs --pack beauty-vol1 --quick` で contact_sheet を確認

## 2026-09-24 向け
- `stream-vol1`（9/24 分）は Claude が 9/23 に実装済み（20デザイン・quick/full ビルド確認済み）。`node factory/calendar.mjs next-design` は `realestate-vol1`（不動産・物件紹介）を返すはずなので、それを20デザイン実装する
- 不動産は「情報ラベル・清潔感・信頼」。フォント: Noto Sans JP 700/900 / Zen Kaku Gothic New 700 / BIZ UDPGothic 700 / M PLUS 1p 900（価格の数字）。色: ネイビー #0b1f3a・白・ベージュ #f3e9d2・グリーン #0e8a7a・アクセントに赤 #d7263d（価格・おすすめ）。box は rect / round の小さめラベルと、下部の情報帯（bar）。装飾は少なめ（dotsLeft / lineBottom 程度）
- 種類の例: 間取り「2LDK」大文字＋sub「専有面積 58.2㎡」／「駅徒歩5分」ピル／「築12年」／家賃「8.5万円」（tag '家賃'、数字を M PLUS 1p 900 で大きく）／販売価格「3,980万円」／「おすすめポイント」タグ＋本文／「内見予約はこちら」CTA／部屋名ラベル「リビング 12帖」「キッチン」「バルコニー」／「南向き・角部屋」ピル2連／「ペット可」「駐車場あり」設備アイコン風ラベル／「周辺環境」章タイトル／「スーパー 徒歩3分」／「リフォーム済み」帯／「管理費 8,000円」小ラベル／注意「※写真は同タイプの別室です」／物件名「〇〇マンション 302号室」下部帯（bar）／「NEW」「値下げ」スタンプ（tag text を variant で差し替え）／「担当者コメント」吹き出し／「お問い合わせ」電話番号欄（数字はダミー 000-0000-0000）
- 実在の不動産会社名・駅名・地名は不可（「〇〇駅」「〇〇市」）。business-vol1 の b-number（数値実績）と被らない形にする
- 9/24 は木曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack realestate-vol1 --quick` で contact_sheet を確認

## 2026-09-23 向け
- `wedding-vol1`（9/23 分）は Claude が 9/22 に実装済み（20デザイン・quick/full ビルド確認済み）。`node factory/calendar.mjs next-design` は `stream-vol1`（配信・ゲーム実況）を返すはずなので、それを20デザイン実装する
- 配信は「ネオン・ピクセル・サイバー」。フォント: DotGothic16 / Train One / Dela Gothic One / M PLUS 1p 900 / Noto Sans JP 900。色: シアン #00e5ff・マゼンタ #ff2d95・ライム #b6ff00・パープル #7a3cff・黒 #0b0b14。glow を主役にし、strokes は細め。tv-vol1 の `game-window` / `music-neon`、shorts-vol1 の `s-neon-outline` と被らない形にする
- 種類の例: 「LIVE」赤ドット付きピル（tag で ●）／「配信中」／「コメント募集中」／「初見さん歓迎」／「今日の目標」（sub で目標内容）／「クリア！」バースト／「GAME OVER」ピクセル／「ランク」（tag で S/A/B を variant 差し替え）／「視聴者参加型」／告知「次回配信」＋日時／「休憩中」／「BGM:」曲名欄／注意事項「ネタバレ注意」／「チャンネル登録・高評価」／「切り抜きOK」／「メンバー限定」／「おつかれさま」エンド／「質問コーナー」／「ハイライト」／「同時接続 1,234」数字強調
- 実在ゲーム名・配信サイト名・配信者名は不可（「〇〇（ゲーム名）」「〇〇さん」）
- 9/23 は水曜なのでアプリも1本。Claude の提案どおり roadmap #10「BASE 商品ギャラリー画像ジェネレーター（社内ツール）」を `apps/base-gallery/` に実装する（各パックの contact_sheet と個別プレビューから 1280×1280 の商品画像 5枚（表紙・デザイン一覧・使い方・同梱物・比較表）を Canvas で生成、PNG 一括 DL。DEMO フラグ不要・listing.md 不要・社内用と README に明記）。時間が無ければ #5「周年記念動画 ヒアリングシート」でもよい
- 完了後 `node factory/build_pack.mjs --pack stream-vol1 --quick` で contact_sheet を確認

## 2026-09-22 向け
- `season-autumn-vol1`（9/22 分）と `apps/call-sheet` は Claude が 9/21 に実装済み。`node factory/calendar.mjs next-design` は `wedding-vol1`（結婚式・イベント映像）を返すはずなので、それを20デザイン実装する
- 結婚式は「上品・余白・細め」。フォント: Shippori Mincho B1 800 / Zen Old Mincho 900 / Zen Kaku Gothic New 700（letterSpacing 0.2〜0.4 で英字を軽く）。色: 白・ゴールド #c9a227・くすみピンク #e8b4b8・ネイビー #0b1f3a・グレージュ #d8cfc4。装飾は lineTop/lineBottom の細線、sparkle 控えめ、ring は使わない
- 種類の例: 新郎新婦名＋日付「Taro & Hanako 2026.10.10」／「Thank you」／章「Prologue」「Opening」「Ending」／席次風「Table 1」／メッセージ引用（両親へ）／乾杯「Cheers!」／余興「Entertainment」／エンドロール（スタッフ名＋役職、2行）／スタッフロール見出し／周年「創立30周年」／表彰「感謝状」／「Welcome」／「ご来場ありがとうございました」／日付スタンプ／会場名タグ／「Happy Wedding」／「Congratulations」／プロフィール「1995年 名古屋生まれ」／「ここに写真」注釈（※写真はイメージ）
- 実在の式場名・人名は不可（「山田 太郎・花子」「〇〇ホテル」）。tv-vol1 の documentary / romance と被らない形にする
- 9/22 は火曜なのでアプリ実装は不要。完了後 `node factory/build_pack.mjs --pack wedding-vol1 --quick` で contact_sheet を確認

## 2026-09-21 向け
- `sports-vol1`（9/21 分）は Claude が 9/20 に先行実装済み。`node factory/calendar.mjs next-design` は `season-autumn-vol1`（季節イベント）を返すはずなので、それを20デザイン実装する
- 4シーズンを5デザインずつ: ハロウィン（紫#5b1a8a・オレンジ#ff7a00・黒、ギザギザ吹き出し burst、コウモリ風は deco で表現できないので色と形で）／紅葉・秋の味覚（暖色、筆文字 Yuji Syuku、Kaisei Decol）／クリスマス（赤#c8102e・緑#0b6b3a・金 GOLD、sparkle deco）／年末年始（和風・金赤、Shippori Mincho B1、Zen Old Mincho、「謹賀新年」「今年もお世話になりました」）
- 種類の例: 「Happy Halloween」「本日のイベント」「トリック・オア・トリート」「仮装コンテスト」／「紅葉狩り」「秋の味覚フェア」「読書の秋」／「Merry Christmas」「クリスマス限定」「イルミネーション点灯」「プレゼント企画」／「謹賀新年」「今年もありがとうございました」「年末セール」「初売り」「あけましておめでとう」「新年の抱負」
- 実在のイベント名・店舗名・キャラクター名は不可。gourmet-vol1 の `g-season`（季節限定グラデ）と被らない形にする
- 9/21 は月曜（祝日）なのでアプリも1本。roadmap の未着手最優先は #5「周年記念動画ヒアリングシート＆構成案ジェネレーター」（無料・営業導線）か #8「撮影香盤表ジェネレーター」（¥1,480・invoice-maker の印刷レイアウト流用）。#8 を推奨（apps/call-sheet/。シーン／時刻／場所／キャスト／機材／備考の行編集、A4 横印刷、CSV 書き出し、DEMO は10行まで）
- 完了後 `node factory/build_pack.mjs --pack season-autumn-vol1 --quick` で contact_sheet を確認

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
