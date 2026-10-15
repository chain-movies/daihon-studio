---
name: chain-cut-auto-edit
description: 素材動画を Chain Cut で自動編集し、完成 MP4 と Chain Cut のプロジェクト(.chaincut.zip)を作る。カット（無音・言い間違い）、文字起こしテロップ、強調テロップ、パンチイン・ズーム・揺れ・トランジション・色味、効果音、BGM、ロゴまで入れる。「この動画を編集して」「自動編集して」「カットしてテロップ入れて」「ショートにして」「このドライブの素材で動画を作って」「〇〇風に編集して」等で使う。
---

# Chain Cut 自動編集

道具は `factory/chain-cut/`（使い方の詳細と plan.json の書式は `factory/chain-cut/README.md`）。
作業フォルダは `work/<日付>_<案件名>/`（.gitignore 済み。素材や完成動画はコミットしない）。

## 0. 最初に確認すること（足りなければ質問する。1回でまとめて聞く）

- 素材：Google ドライブの共有リンク（「リンクを知っている全員」）／チャット添付／パソコン内のパス
- 用途と形：縦 9:16（ショート・リール）か横 16:9（YouTube）か、目標の尺
- 雰囲気：参考動画やスタイル名（`factory/chain-cut/styles/` にあるもの）。なければ内容から決めて提案
- BGM：手持ちの曲ファイルがあるか（なければ BGM なしか、あとで差し替え前提）
- 固有名詞（出演者名・社名・商品名）：文字起こしの精度が上がる
- 製品版テロップを使うなら環境変数 `CHAIN_CUT_CODE` があるか（なければ無料デザインかスタイルの独自デザインを使う）

## 1. 準備

```bash
pip install -q faster-whisper gdown numpy   # 未インストールなら
W=work/$(date +%Y%m%d)_案件名; mkdir -p $W/src
python3 factory/chain-cut/fetch_drive.py "<共有リンク>" --out $W/src     # ドライブの場合
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of compact $W/src/*
```

## 2. 文字起こし

```bash
python3 factory/chain-cut/transcribe.py $W/src/main.mp4 --out $W/words.json --prompt "出演者名や商品名"
```

結果を読み、話の流れ・要点・強調すべき一言・言い間違い／言い直し／不要な前置きを把握する。

## 3. 編集プラン（plan.json）を書く — ここが腕の見せどころ

`$W/plan.json` を書く。時刻は文字起こしの秒（`src`）で書けば、無音カット後の位置に自動で合う。

- **カット**：基本は `silenceCut`。言い間違い・言い直し・冗長な部分は `keep` で明示的に落とす（文字起こしの単語時刻を使う）
- **テロップ**：`telopsFromTranscript` で全文字幕を下敷きにし、誤字や不要語は `exclude`、要点は `telops` に `emphasis: true` で追加。1枚 12〜16 文字、表示 0.8 秒以上
- **演出**：強調の一言に `punch`＋`don`、話題の切り替わりに `flash` か `whip`＋`whoosh`、オチに `boing`/`chin`、正解・ポイントに `seikai`/`pikon`、ゆっくり語る所に `zoomIn`。やりすぎない（目安：30秒に3〜5個）
- **BGM**：-20〜-24dB、頭 1 秒フェードイン・最後 2 秒フェードアウト
- **縦動画**：横素材は `fit: "cover"` で自動トリミング（既定）。テロップは中央下寄り（下 20% は SNS の UI がかぶる）
- 実在の番組名・局名・他社ロゴは使わない

## 4. 組み立て → 確認 → 書き出し

```bash
node factory/chain-cut/build.mjs $W/plan.json --out $W/out          # .chaincut.zip と edit-summary.md
node factory/chain-cut/render.mjs $W/out/*.chaincut.zip --out $W/out/preview.mp4 --res 0.5   # まず確認用（速い）
ffmpeg -v error -i $W/out/preview.mp4 -vf "fps=1/3,scale=240:-2,tile=6x3" -frames:v 1 $W/out/check.jpg
```

`check.jpg` と `edit-summary.md` を見て、テロップのはみ出し・誤字・演出の位置・カットの不自然さを直す（plan.json を直して再ビルド）。
音はレベルを確認：`ffmpeg -i preview.mp4 -af ebur128=framelog=quiet -f null - 2>&1 | grep "I:"`（-14〜-16 LUFS が目安。大きくずれたら素材の volumeDb や BGM を調整）。

良ければ本番：

```bash
node factory/chain-cut/render.mjs $W/out/*.chaincut.zip --out $W/out/完成.mp4      # フル解像度
```

## 5. 納品

- 完成 MP4 と .chaincut.zip を SendUserFile で渡す（MP4 は display: "render"）
- 報告：尺（元 → 完成）、カット数、テロップ数、入れた演出と効果音、気になった点（聞き取れなかった所・誤字の可能性）
- 「Chain Cut で開けば（https://chain-movies.github.io/daihon-studio/apps/chain-cut/ → ファイル → プロジェクトを開く）テロップや演出を手で直せる」と伝える
- 直しの依頼が来たら plan.json を直して 4 からやり直す
