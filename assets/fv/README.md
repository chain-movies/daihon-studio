# FV背景動画（E案「光のリボンが渦を巻いて字になる」）

絵コンテPDF（E案）を元に生成AIで制作したHPファーストビュー用の背景動画。
キャッチコピー・ボタンは含まず、背景（富士・湖面・朝日・金の「誉」）のみ。

| ファイル | 用途 |
| --- | --- |
| `fv_homare_E_main_audio_1920x1080.mp4` / `.webm` | 本命（BGM・SE入り）。H.264+AAC / VP9+Opus / 1920x1080 / 24fps / 5.00秒 |
| `fv_homare_E_main_1920x1080.mp4` / `.webm` | 同じ映像の無音版（ミュート自動再生用） |
| `fv_homare_E_poster.jpg` | 読み込み時のposter画像（C1 夜明け前、本命の先頭フレーム） |
| `fv_homare_E_lastframe.jpg` | 最終フレーム（再生終了後の静止表示用、金属質の金） |
| `fv_homare_E_metal_halo_5s_1920x1080.mp4` / `.webm` | 旧本命（3.71秒で保持し、ハロとハイライトを後付けした版） |
| `fv_homare_E_lastframe_metal_halo.jpg` | 旧本命の最終フレーム |
| `fv_homare_E_seedance_glow_5s_1920x1080.mp4` / `.webm` | 旧本命（Seedance素材、白金色に光る「誉」で終わる5秒版） |
| `fv_homare_E_lastframe_seedance_glow.jpg` | 旧本命の最終フレーム |
| `fv_homare_E_main_noglow_1920x1080.mp4` / `.webm`、`_settle`、`_peakhold` | Seedance素材の過去バリエーション（発光なし／マット金＋グロー／光った瞬間で保持） |
| `metal_evolve.py` | 旧本命（ハロ後付け版）の合成スクリプト |
| `glow_effect.py` / `peak_hold.py` / `peak_evolve.py` | 過去バリエーションの合成スクリプト |
| `fv_homare_E_alt1_seedance_1920x1080.mp4` | 予備案1。リボンの走行が長めの別テイク（5.04秒） |
| `fv_homare_E_alt2_minimax_1920x1080.mp4` | 予備案2。別モデル生成。字の質感がやや立体的（5.17秒） |
| `fv_homare_E_startframe_source.png` | 生成に使った開始フレーム（2752x1536） |
| `fv_homare_E_endframe_source.png` | 生成に使った終了フレーム（金の「誉」合成済み） |

## 本命のタイムライン（絵コンテ対応）

| カット | 絵コンテ | 動画 |
| --- | --- | --- |
| C1 夜明け前・静止 | 0.00–1.60 | 0.0–2.0 |
| C2 太陽が出て光の筆が走る | 1.60–2.40 | 2.0–3.2 |
| C3 渦を巻き結像 | 2.40–3.30 | 3.2–4.5 |
| C4 金属質の金の「誉」 | 3.30–4.60 | 4.5–5.0（最終フレームで停止） |

MiniMax H3（2K）で生成した素材を1080pに変換し、金属質の金が最も強い3.71秒までの区間を
動き補間（ffmpeg minterpolate）で1.33倍にスロー化して5.00秒ちょうどに収めた。
後付けの発光処理はなし。最終フレームは素材の3.71秒のフレームそのもの。

再生成コマンド（素材の1080p連番PNGが `mm_frames/` にある前提）:

```
ffmpeg -framerate 24 -i mm_frames/%04d.png \
  -vf "trim=end_frame=90,setpts=PTS*(120/90),minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p" \
  -an -c:v libx264 -preset slow -crf 17 -movflags +faststart out.mp4
```
（出力118フレームの末尾に素材90フレーム目を2枚足して120フレーム＝5.00秒にする）

## 音（BGM / SE）

映像は確定版（`fv_homare_E_main_1920x1080.mp4`）をそのまま使い、音声だけを付加した。
素材はすべて Mixkit（Mixkit License: 商用利用可・クレジット不要）からダウンロード。
`audio/` に素材・ミックス済みWAV・ミックススクリプト（`mix.py`、ffmpeg）を同梱。

| 時間 | 絵コンテの音指定 | 使用素材 | 配置 |
| --- | --- | --- | --- |
| 0.0– | C1 低いドローン音のみ | 楽曲「Vastness」冒頭 | ベッドとして全体に敷く（0.6秒フェードイン） |
| 1.95 | C2 太陽の出に鈴を一打 | SE「Relaxing bell chime」 | 日の出の瞬間に一打 |
| 2.2–3.5 | C2 筆に擦過音を薄く | SE「Magical light sweep」 | 光の筆の走行に合わせ2.9秒で頂点 |
| 1.8–5.0 | C3 渦に持続音 | SE「Cinematic whoosh magic gust」 | 渦から結像へ向けて高まり、4.5秒で頂点 |
| 4.35– | C3/C4 結像に金属質のきらめき、着地 | SE「Choir magic shine」+「Fairy glitter」 | 金属質の「誉」が定着する瞬間 |

- ラウドネス: -15.6 LUFS（integrated）、トゥルーピーク -1.5 dBTP。末尾0.38秒でフェードアウト。
- 音量バランスの変更は `audio/mix.py` の `layers` のゲイン（dB）を変えて再実行。

## 実装メモ

- ブラウザの自動再生は音ありだと止められるため、FVでは無音版を `autoplay muted playsinline` で流し、音あり版はユーザー操作後（音声ONボタン等）に切り替える想定。

- 画は上へ4%オフセット（絵コンテ指示）: `object-position: 50% 46%` などで対応。
- 終了後は最終フレームで静止させる（`loop`なし、`autoplay muted playsinline`）。
- 生成: 静止画 Nano Banana Pro、動画 MiniMax H3（start/end frame指定）。旧本命は Seedance 2.5。
