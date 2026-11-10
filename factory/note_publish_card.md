# note 公開手順カード（1 本 30 分・机に置く 1 枚）

目的: 下書き 7 本（No.23〜29）を、週 1 本・30 分で公開する。考えずに上から順に押すだけにする。公開ボタンは人間が押す。

## 公開前チェック（3 項目・2 分）
- [ ] 公開する No を決めた（順番: 24 → 25 → 26 → 27 → 28 → 29。No.23 は最後でよい）
- [ ] その No の投稿ガイドを開いた: `content/note/<フォルダ>/guide.md`（下の表のフォルダ）
- [ ] note にログインしている（ブラウザ 1 枚・Drive の Doc はもう 1 枚）

## 8 手順（1 本 25 分）
| # | やること | 開くもの | 目安 |
|---|---|---|---|
| 1 | Drive の本文 Doc を開き、全選択 → コピー | 下の表「本文 Doc」の URL | 1 分 |
| 2 | note → 「投稿」→「テキスト」で新規記事を開き、貼り付け | https://note.com/ | 1 分 |
| 3 | 1 行目をタイトル欄へ移す（本文の先頭行がタイトル） | — | 1 分 |
| 4 | 「■」で始まる行を選んで「見出し（大）」にする（4〜5 か所） | — | 3 分 |
| 5 | 本文中の URL 行（https://raw.githubusercontent.com/…png）をコピーして画像を挿入 → URL の行は消す。［図解①］などの行も消す | 画像 URL は本文に入っている | 8 分 |
| 6 | ［挿絵①］の位置: Drive「note編集部素材」に no〇〇_illust1.png があれば挿入、無ければ行ごと消す | Drive 1cjsEvXEo5s3YxGYcRKoFRRsLBCPzACoS（生成キュー）の隣 | 2 分 |
| 7 | 見出し画像を設定（ヘッダー画像 URL を保存してアップロード） | 下の表「ヘッダー」 | 3 分 |
| 8 | タグ 5 個（guide.md の「タグ」行）→ 公開ボタン → 公開 URL をコピーして Claude に貼る | — | 3 分 |

公開後は Claude 側で `node factory/note_published.mjs <No> <URL>` を実行し、台帳と次の記事の「前回の記事」リンクを自動で入れる。

## 記事ごとの場所（コピーして使う）
| No | フォルダ（guide.md・header.png） | 本文 Doc |
|---|---|---|
| 24 | content/note/2026-09-18-srt-tool/ | https://docs.google.com/document/d/1yidKaR878e_sEyINn8fOjozaThvcd5QuzJRjUZqTV0g/edit |
| 25 | content/note/2026-09-24-anniversary/ | https://docs.google.com/document/d/1gUHm442gaW8t5T5YnCyzBa3P4NyCYrLDLpCVrUEvQtQ/edit |
| 26 | content/note/2026-10-08-30packs/ | https://docs.google.com/document/d/108zcEM3AA7ZBCADHYu1CgRVOQKrCtrJOxJC_rFNhh8g/edit |
| 27 | content/note/2026-10-19-factory20min/ | https://docs.google.com/document/d/1XcVCm5ML7skRRWSIzwzEtpUFr5jQ0r-fKHHXe7_Gwdk/edit |
| 28 | content/note/2026-10-21-zero-sales/ | https://docs.google.com/document/d/1_3COZ8wgkAfalNAX9ZLeIkgMg2_pyGo9KData2AcsC8/edit |
| 29 | content/note/2026-10-28-thirty-minutes/ | https://docs.google.com/document/d/1mNA5U2BsAb528cMsviAPLouWT--EsCXvIEIXWznu0sU/edit |

ヘッダー画像・図解の URL は `https://raw.githubusercontent.com/chain-movies/daihon-studio/claude/monetization-tool-rebuild-qp828g/content/note/<フォルダ>/header.jpg` の形（ブラウザで開いて右クリック保存）。

## No.24 だけの注意（最初の 1 本）
- 本文末尾のツール URL（ https://chain-movies.github.io/daihon-studio/apps/srt-splitter/ ）はブランチ未マージだと 404。公開前にブラウザで開く。開かなければその行を消して「ツールは準備中」に書き換える
- 「今日の午前に上がってきた」は 9/18 基準の表現。「先日」に直す

## 困ったとき
- 画像が挿入できない → URL をブラウザで開いて画像を保存し、note の画像ボタンからアップロード
- 見出しがうまく付かない → 行頭の「■ 」は残したまま見出しにしてよい（統一されていれば OK）
- 30 分で終わらない → 手順 5 の画像を 1 枚だけにして公開してよい。残りは翌週に追加編集
