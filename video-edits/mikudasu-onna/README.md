# 「見下す女」自動編集アセット

ショートドラマ1本（縦型 1080x1920 / 単一カット / 素材 145.02秒）の編集レシピ。
Premiere Pro に適用する場合はこのフォルダの `cutlist.json` と `telop_manifest.json` を使う。

## 素材
- Google Drive: `見下す女` (1o2sg8bpRCGVeupyedBAK6P8srK-jthP_) / QuickTime HEVC 1920x1080 + rotate -90 / 30fps / 145.02s
- シーンチェンジ検出 0件 = カメラ切り替えなしの単一テイク

## 編集方針（ユーザー確定）
- テロップ: 看ドラ確定スタイルの **黒帯なし版**
  - 白 / Noto Sans CJK JP Bold / 実 100px / 1画面最大12文字（11〜12文字は幅970pxに収まるよう自動縮小）
  - 黒縁取り 8px ＋ 薄い黒影（帯がないぶん縁取りで可読性を確保）
  - 位置: 画面中央下 y=1375（顔に被らず、下25%のプラットフォームUI帯も避ける）
  - 文節単位・発話同期・無音中は非表示・句読点で必ず分割
- カット: 「間を活かす・弱め」（芝居のテンポと間を尊重）

## カット内容
| 区間(素材) | 長さ | 内容 |
|---|---|---|
| 0.00 – 4.30 | 4.30s | 冒頭の無発話区間（物音のみ。単独窓で再転写しても発話ゼロ）→ ハードカット |
| 120.60 – 123.80 | 3.20s | リツコ退出後、一人で黙っている間の中だるみ → 0.4秒クロスディゾルブで時間経過として接続 |

**残した間（意図的に保持）**
- 76.44–84.62 (8.18s): 「手取り28万のうち半分は私の時給」直前のタメ
- 114.10–120.20 (6.10s): 決め台詞後〜リツコ退出のアクション
- 124.20–128.36 (4.16s): スマホを手に取るまでのアクション（オチへの導線）

出力: **137.12秒**（-7.90s）

## 言い直し判定
- 136.88–141.06 の「転職してさ3ヶ月で28万／うちの会社来ない?」は冒頭 4.38–11.42 とほぼ同一だが、
  **脚本上の反復＝オチ**。言い直し検出に引っかかるが**カット禁止**。
- 56.06 の「それ」重複はテロップ側でのみ1回に整理（映像はカットしない）。

## ファイル
| ファイル | 用途 |
|---|---|
| `cutlist.json` | keep_segments / cuts / 残した間 / 要確認フラグ。`render_timeline` が書き出しの実タイムライン |
| `script.json` | Whisper large-v3 の出力を人手校正した台本（`fix` に修正内容を記録） |
| `transcript_lv3.json` | Whisper large-v3 の生の単語タイムスタンプ |
| `telop.ass` | 焼き込み用字幕（ffmpeg `subtitles=` フィルタ） |
| `telop.srt` | 汎用字幕 |
| `telop_manifest.json` | Premiere 用。透過PNGのファイル名・表示区間（編集後タイムライン基準） |
| `build_captions.py` | script.json → 文節分割 → telop.ass 生成 |
| `make_telop_png.py` | telop.ass → 透過PNG 59枚（`telop_png/`）生成。Premiere の V2 に overwriteClip する |

## 再現手順
```sh
pip install faster-whisper budoux pillow --break-system-packages
apt-get install -y ffmpeg fonts-noto-cjk
python3 build_captions.py          # -> telop.ass
python3 make_telop_png.py          # -> telop_png/ + telop_manifest.json
ffmpeg -i source.mov -filter_complex "
 [0:v]trim=4.30:120.60,setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos,format=yuv420p[va];
 [0:v]trim=123.80:145.02,setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos,format=yuv420p[vb];
 [va][vb]xfade=transition=fade:duration=0.4:offset=115.90[vx];
 [vx]subtitles=telop.ass:fontsdir=/usr/share/fonts[vout];
 [0:a]atrim=4.30:120.60,asetpts=PTS-STARTPTS[aa];
 [0:a]atrim=123.80:145.02,asetpts=PTS-STARTPTS[ab];
 [aa][ab]acrossfade=d=0.4[aout]" \
 -map "[vout]" -map "[aout]" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 \
 -c:a aac -b:a 192k -movflags +faststart 見下す女_edited.mp4
```

## 注意（libass のフォントサイズ）
libass は CJK フォントの hhea メトリクスで文字を縮めるため、ASS に `Fontsize: 100` と書くと
実測 **67px** になる。実 100px にするには **148** を指定する（`build_captions.py` の `ASS_FONT_SIZE`）。
Premiere 側の PNG は Pillow で実 100px を直接描画しているのでこの補正は不要。

## BGM
未適用（BGM素材の指定なし）。ダイアログ主体のドラマのため、入れる場合は
発話中 -12〜-15dB のダッキングを推奨。
