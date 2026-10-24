# Instagram インサイト自動収集

Instagram の公式 API（Graph API v25.0 / Instagram Login）から、投稿単位とアカウント単位の
インサイトを自動でスプレッドシートに蓄積する Google Apps Script。

スクレイピングは一切していません。規約上クリーンな公式APIのみを使います。

## これで取れるようになるもの

これまでインサイト画面のスクショでしか見られなかった数字が、毎日自動で表に溜まります。

| 区分 | 取得内容 |
|---|---|
| 投稿単位 | views / reach / likes / comments / saved / shares / total_interactions / reposts |
| リールのみ | 平均視聴秒（ミリ秒を秒に換算済み）/ スキップ率 |
| フィード・ストーリーのみ | follows / profile_visits |
| アカウント日次 | reach / views / accounts_engaged / profile_links_taps / follows_and_unfollows ほか |
| フォロワー属性 | 年齢 / 性別 / 都市 / 国 |
| 自動計算 | 保存率 / シェア率 / エンゲージメント率 / フォロー転換率 |

## 先に知っておくべき制限

- **リールには `profile_visits` と `follows` が無い**（API仕様）。リールのフォロー転換は
  アカウント日次の `follows_and_unfollows` から見る
- **`impressions` は廃止済み**（v22.0以降）。後継は `views`
- **フォロワー100人未満のアカウントは属性データが取れない**
- **データは最大48時間遅延**する
- **長期トークンは60日で失効**する。月次トリガーの登録は必須

## セットアップ

### 1. Instagram をプロアカウントにする

対象アカウント（@kuriseka / @kandora_ouchinosato）を
**ビジネス** または **クリエイター** に切り替える。個人アカウントでは API が使えません。

設定 → アカウントの種類とツール → プロアカウントに切り替える

### 2. Meta for Developers でアプリを作る

1. https://developers.facebook.com/apps/ → 「アプリを作成」
2. ユースケースは **「Instagram」** を選ぶ
3. 作成後、左メニューの **Instagram** → 「API設定」を開く

### 3. トークンを取る

アプリ管理画面の Instagram セクションに **「アクセストークンを生成」** があります。
OAuth のリダイレクトURLを用意しなくても、ここから直接取得できます。

- 必要なスコープ: **`instagram_business_basic`** と **`instagram_business_manage_insights`**
- 生成されるのは短期トークン。長期（60日）に交換する:

```
GET https://graph.instagram.com/access_token
  ?grant_type=ig_exchange_token
  &client_secret=<アプリのシークレット>
  &access_token=<短期トークン>
```

アカウントごとに1つずつトークンが必要です（クリセカ用・看ドラ用で別々）。

### 4. スプレッドシートと GAS を用意する

1. 新規スプレッドシートを作る（名前は「Instagram インサイト台帳」など）
2. 拡張機能 → Apps Script
3. `Code.gs` の中身を貼り付けて保存

### 5. 初期化する（実行順）

| 順 | 実行する関数 | やること |
|---|---|---|
| 1 | `セットアップ_シートを作る` | 設定 / 投稿 / アカウント日次 / フォロワー属性 / ログ の5シートを作成 |
| 2 | `セットアップ_トークンを保存` | 関数内の `保存する` にキーとトークンを書いてから実行。**実行後、必ず文字列を消す** |
| 3 | `確認_ユーザーIDを取得` | 実行ログに IGユーザーID が出る |
| 4 | （手作業） | 設定シートの「IGユーザーID」列に貼る |
| 5 | `収集` | 手動で1回動かして、投稿シートに行が入るか確認 |

トークンをコードに残さないでください。スクリプトプロパティに入ってしまえば、
コード側の文字列は不要です。

### 6. トリガーを登録する

時計アイコン（トリガー）から2つ登録します。

| 関数 | 頻度 | 理由 |
|---|---|---|
| `収集` | 日次（朝6〜7時） | データは48時間遅延するので毎日で十分 |
| `月次_トークン更新` | 月1回 | 60日で失効するため。**登録し忘れると2ヶ月で止まります** |

## 仕様が変わったとき

Meta は指標名を頻繁に変えます。このスクリプトは**使える指標を自動で探索してキャッシュ**するので、
1つ廃止されても収集全体は止まりません。

ただし新しい指標が追加されたときは、キャッシュを消して再探索させてください。

1. `Code.gs` の `MEDIA_METRIC_CANDIDATES` / `ACCOUNT_METRIC_CANDIDATES` に新指標を追記
2. `指標キャッシュを消す` を実行
3. 次回の `収集` で自動的に再探索される

## 動かないときの見どころ

| 症状 | 原因 |
|---|---|
| 投稿シートに何も入らない | 設定シートの IGユーザーID が空、または「有効」が FALSE |
| ログに `OAuthException` | トークン失効。`月次_トークン更新` を手で実行するか、取り直す |
| フォロワー属性が0行 | フォロワー100人未満。仕様なので正常 |
| リールの follows が常に空 | API仕様。リールにこの指標は存在しない |
| 一部の指標だけ空 | 自動探索で除外された。ログシートを確認 |

## 出典

- [Instagram User Insights（Meta公式）](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights)
- [Instagram Media Insights（Meta公式）](https://developers.facebook.com/docs/instagram-api/reference/ig-media/insights)
- [Business Login for Instagram（Meta公式）](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)

## 補足：アカウント日次シートの読み方

Instagram の `metric_type=total_value` は、指定した期間（既定30日）を**1つに合算した値**を返します。
日別の内訳ではありません。そのため各行には「集計開始日」と「集計終了日」の両方を記録しています。

日ごとの推移を見たい場合は、毎日実行して**行が積み上がっていくのを時系列として使ってください**
（同じ30日窓が1日ずつずれて記録されるため、差分で日次の動きが読めます）。
`DAYS_BACK` を 1 にすれば実質の日次値になりますが、48時間の遅延があるため取りこぼしが出ます。
