# パック実装の型（20 の場面テンプレート）

毎朝のパック実装を「brief を読んで 20 個考える」から「型に業種の言葉を入れる」に変えるためのメモ。
下の 20 枠を業種の語彙で埋め、色 3 色＋注意色・フォント 3〜4 種を決めれば、1 パック 20 デザインになる。
（brief に特有の場面があれば、枠 6・9・13・17 あたりを差し替える）

## 20 枠（枠名｜推奨 box／anchor／サイズ｜備考）

| # | 枠 | box・anchor | 主文 size | 備考 |
|---|---|---|---|---|
| 1 | オープニング（〇〇からこんにちは／本日の1本） | round or skew・center middle | 92〜120 | 影あり。筆文字・丸文字は 1 パック 1 つまで |
| 2 | 章タイトル（番号 or 英字サブ） | rect/round・center middle・lineBottom or tag above | 84〜96 | tag above は anchor bottom でなくても middle なら OK |
| 3 | 上部帯 or 下部帯（名前・イベント名・製品名） | bar・top/bottom margin 0・align center | 54〜72 | tag left で日付や NEW |
| 4 | 名前＋肩書（ネームプレート） | rect・left bottom・sub below | 66〜76 | sub は box 付き |
| 5 | 数字 ①（価格・金額） | rect・left bottom・tag left・accent bottom | 92〜118（M PLUS 1p 900） | 赤は価格・注意のみ |
| 6 | 数字 ②（時間・距離・割合） | rect・left bottom・sub below | 80〜96 | |
| 7 | 時刻・日付 | rect・left top or bottom・tag left | 66〜84 | |
| 8 | 場所・アクセス | rect・left bottom・tag left | 60〜70 | |
| 9 | タグ差し替え（レベル／種類／STEP 1〜4） | rect・left top・tag left | 58〜70 | variants で tag.text を差し替え（3〜4 色） |
| 10 | ピル（無料・予約制・OK 系） | pill・right top or left top | 48〜56 | 影あり |
| 11 | スタンプ（注目・新作・本日の目玉） | burst・right top | 54〜76 | padY 30 |
| 12 | チェック ✓／□ | rect/round・left middle・tag left '✓' | 60〜66 | |
| 13 | 対比 ×／○ or Before／After | rect・left middle・tag left・sub above | 64〜70 | 2 デザインに分けてもよい |
| 14 | ポイント／結論／ここが凄い | rect・left bottom or center middle・tag left or triangleLeft(size 56, gap 72) | 64〜70 | |
| 15 | Q&A（Q／A 差し替え） | rect・left bottom・tag left 'Q' | 64〜70 | variants で A |
| 16 | 引用／吹き出し（〇〇より・お客様の声） | rect accent left or speech・left bottom margin 110・sub above or tag above | 56〜66 | speech は anchor bottom margin 110 |
| 17 | 注意／お願い 帯 | rect・left bottom・tag left | 52〜64 | 色は業種の注意色（赤を避ける業種は茶・藍） |
| 18 | 小ラベル（出典・クレジット・天気・写真提供） | rect・right bottom margin 70 | 32〜36 | |
| 19 | CTA（予約・問い合わせ・体験） | pill・center bottom・sub below | 64〜76 | 影あり |
| 20 | エンド（ありがとうございました） | round accent left・center middle・sub above | 60〜72 | sub は影付き文字 |
| 予備 | まとめ帯 | bar・bottom margin 0・align center・accent top | 64〜72 | 枠 3 と被らないときに |

## 共通ルール（renderer の制約）
- tag.position は 'left' / 'above' のみ。'above' を使うときは anchor.y を 'bottom' か 'middle' に（'top' だと画面上端にかかる）
- bar は `align: 'center'` を付けないと左寄せ
- box.accent.side は left / top / bottom のみ（right は無い）
- sub.align は 'left' か 'center' のみ（'right' は箱がずれる）。右寄せ配置は anchor.x 'right' ＋ sub.align 'left'
- deco triangleLeft は size 56・gap 72（gap 10 だと箱の下に隠れる）
- サイズは上の表の値で最初から書く（後から 1.2 倍にすると tag と sub のバランスが崩れる）
- フォントは FONTS にあるものだけ。筆文字・手書き（Yuji Syuku / Klee One / Yusei Magic / Hachi Maru Pop）は 1 パック 1 つ
- 入れた後に `DESIGNS.filter(pack).length === 20` と id の重複を確認

## 色の決め方
- ベース（白 or 黒）＋ 業種の色 1 ＋ 差し色 1 ＋ 注意色（赤。医療・介護・整体・葬儀は赤を避けて茶や藍）
- variants は「業種色／差し色／反転」の 3 つを基本に、タグ差し替えの枠だけ 4 つ

## 所要時間の目安
- 型を埋める 8 分 → quick 2 分 → 目視 1 分 → full＋画像＋CSV 6 分（バックグラウンド）→ 報告 3 分 = 20 分
