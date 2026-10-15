---
name: chain-cut-trace-style
description: 参考動画（URL・画面録画・スクショ・自社/クライアントの動画ファイル）から、テロップのデザイン・カットのテンポ・色味・効果音の使い方・アニメーションを読み取り、Chain Cut の「スタイル」(factory/chain-cut/styles/*.json) として再現する。「この動画みたいに編集して」「この参考のテロップを真似して」「〇〇風の演出を作って」「参考動画をトレースして」等で使う。作ったスタイルは chain-cut-auto-edit でそのまま使える。
---

# 参考動画の演出をトレースする

## 0. 受け取り方（規約と権利）

- YouTube・TikTok・Instagram などの URL は **自動でダウンロードしない**（各サービスの規約違反）。URL はメモとして受け取り、
  実物は「画面録画」か「スクショ数枚（テロップが出ている場面）」を Google ドライブの共有リンクかチャット添付でもらう
- 自社・クライアントの動画ファイルはそのまま使ってよい
- 真似するのは「雰囲気・構成・テンポ・配色の傾向」まで。番組ロゴ・局名・キャラクター・固有の図柄、他人の素材そのものは写さない。スタイル名も「〇〇風」までにする

## 1. 分析

```bash
W=work/ref_$(date +%Y%m%d)_名前; mkdir -p $W
python3 factory/chain-cut/fetch_drive.py "<共有リンク>" --out $W/src     # 必要なら
node factory/chain-cut/trace.mjs $W/src/参考.mp4 --out $W              # スクショならフォルダを渡す
```

`report.md` の数値（平均ショット長・1分あたりのカット数・明るさ/彩度・ラウドネス・無音率）と、`sheet_*.jpg`・`frames/*.jpg` を **実際に画像として見て** 読み取る：

- テロップ：位置（上/中央/下、左右）、画面幅に対する大きさ、文字色、縁取りの色と太さと重ね数、帯・座布団の形と色、影、フォントの雰囲気（角ゴ太・丸ゴ・明朝・手書き・ポップ）、1枚の文字数
- 強調テロップ：通常との違い（色・大きさ・位置）
- 演出：ズーム（パンチイン）の頻度、揺れ、フラッシュ／暗転、ワイプ（小窓）、色味（鮮やか／シネマ／レトロ）
- 音：BGM が常に鳴っているか（無音率が低い）、効果音の多さ（話の切れ目ごとに鳴るか）
- アニメーション：テロップが出る瞬間を `--burst 秒` で 1/30 秒ごとに見る

```bash
node factory/chain-cut/trace.mjs $W/src/参考.mp4 --out $W --burst 12.4
```

文字起こしが必要なら（話す速さ・テロップの出し方の比較）`transcribe.py` も使う。

## 2. スタイルを書く

`factory/chain-cut/styles/<英数字の名前>.json` を書く（形式は `factory/chain-cut/README.md`、手本は `styles/shorts-variety-pop.json`）。

- `designs`：テロップの spec。書き方は `telop/designs.js` の既存デザイン（font / fill / strokes / shadow / extrude / glow / box / tag / sub / deco / anchor / portraitScale / align）
  - フォントは `telop/designs.js` の `FONTS` にあるものだけ（Noto Sans JP, Dela Gothic One, M PLUS 1p, Zen Maru Gothic, Mochiy Pop One, RocknRoll One, Reggae One, Potta One, Zen Old Mincho, Shippori Mincho B1, Kaisei Decol, Hachi Maru Pop, Yusei Magic, DotGothic16 など）。近い雰囲気のものを選ぶ
  - 縦動画なら `portraitScale: 1`。`anchor.margin` は横幅の自動縮小にも効くので 60〜140 程度に抑え、高さはスタイルの `telop.y`（px、上がマイナス）で合わせる
- `telop`：通常／強調のデザイン、登場アニメ（pop / slideUp / slideLeft / wipe / type）、効果音、1枚の文字数
- `cut`：無音カットの強さ（平均ショット長が短いほど minSilence を短く、pad を小さく）、`jumpCutZoom`（ジャンプカットで交互に寄るなら 1.05〜1.12）、`transition`
- `look`：色味（明るさ・彩度の数値から cinema / vivid / retro / mono / bright か fx を直接）
- `bgm.volumeDb`：BGM の大きさ
- `description` に「どこを真似たか」を一言で

## 3. 答え合わせ（必ずやる）

```bash
node factory/chain-cut/preview_style.mjs factory/chain-cut/styles/<名前>.json --frame $W/frames/<テロップが映っているフレーム>.jpg --text "参考と同じ文字数の文"
```

出力画像（左：参考／右：再現）を見て、大きさ・位置・色・縁の太さが近づくまで spec を直して繰り返す（2〜4 回が目安）。
最後に短いテスト素材で chain-cut-auto-edit の手順 4 を回し、動きと音も確認する。

## 4. 報告

- 比較画像を SendUserFile で見せる（display: "render"）
- 読み取った特徴の箇条書き（テンポ、テロップ、演出、音）と、再現しきれなかった点（フォントが手持ちにない、特殊な動き など）
- 「このスタイルで編集して」と言えば使えること
- スタイル JSON はリポジトリに入れてよい（素材・参考動画そのものは入れない）
