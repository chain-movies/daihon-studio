# factory/base — BASE 出品キット

`node factory/base_kit.mjs` で生成。**BASE に登録する文章・価格・画像URLを、パックごとに用意したもの。**
手作業は「ZIP を付ける」だけに減らすのが狙い。

## なぜ全自動にしないか

- BASE には公開 API（BASE API）があり、商品・価格・画像はアプリ登録＋OAuth 認可で外部から登録できる。
  ただし **開発者登録・アプリ作成・認可は BASE アカウント所有者（マッキー）が BASE 上で行う必要**があり、Claude 側で勝手に外部サービス登録はしない運用にしている。
- 売り物の ZIP は「デジタルコンテンツ販売 App」で商品に紐づけるが、これは **API 非対応（管理画面から手動アップロードのみ）**。
  → 商品情報は CSV で一括登録、ZIP だけ 1 商品ずつ付ける、が現実的な最短ルート。

## 使い方（2ルート）

### A. CSV で一括登録（商品数が多い時）

1. BASE 管理画面 → Apps → **「CSV商品管理」** を追加
2. `factory/base/items.csv` をアップロード（UTF-8 BOM 付き。商品画像は URL 指定）
   - 列: 商品名 / 説明 / 価格 / 税率 / 在庫数 / 公開状態 / 表示順 / 商品画像1〜7
   - App がダウンロードさせる雛形 CSV と列名が違う場合は、その雛形の列名をこちらに教えてもらえれば合わせる
3. 各商品に **デジタルコンテンツ販売 App** で ZIP を付ける（`<pack>/zip.txt` に Release の URL とファイル名）
4. 公開したら商品 URL を `shop/links.json` の `packs.<pack>.base` に入れる（Claude に貼ってもらえば反映する）

### B. 1 商品ずつ手入力（最初の数点）

`factory/base/<pack>/` の各ファイルをコピペ:

| ファイル | 貼る場所 |
|---|---|
| `title.txt` | 商品名 |
| `description.txt` | 商品説明（そのまま） |
| `price.txt` | 価格（税込） |
| `images.txt` | 商品画像。URL を開いて保存 → アップロード（7 枚、順番どおり） |
| `tags.txt` | タグ／検索ワード欄があれば |
| `zip.txt` | 販売用 ZIP の取得元（GitHub Release）とファイル名 |

## 画像 URL について

`https://raw.githubusercontent.com/chain-movies/daihon-studio/main/factory/gallery/<pack>/...`
main ブランチを参照するので、**作業ブランチをマージしていない間は 404** になる。
マージ前に使うなら `node factory/base_kit.mjs --ref claude/monetization-tool-rebuild-qp828g`。

## オプション

```
node factory/base_kit.mjs                       # built 済み（Release 済み）パック全部 → items.csv
node factory/base_kit.mjs --pack cooking-vol1   # 1 パックだけ（items.csv もその 1 件で上書き）
node factory/base_kit.mjs --ref <branch>        # 画像 URL の参照ブランチ
```
