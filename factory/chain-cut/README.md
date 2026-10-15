# Chain Cut 自動編集ツール

Claude Code に「この動画を編集して」と頼むと、カット・テロップ・演出・効果音・BGM・アニメーションまで入った
**完成 MP4** と、Chain Cut で開いて直せる **プロジェクト（.chaincut.zip）** を作るための道具一式。

手順は `.claude/skills/chain-cut-auto-edit/SKILL.md`（自動編集）と
`.claude/skills/chain-cut-trace-style/SKILL.md`（参考動画のトレース）に書いてある。

## 流れ

```
素材（Google ドライブの共有リンク）
  └ fetch_drive.py ……… ダウンロード
  └ transcribe.py ……… 文字起こし（単語ごとの時刻）
  └ Claude が plan.json を書く（どこを切る・何を出す・どこで鳴らす）
  └ build.mjs …………… plan.json → project.json ＋ .chaincut.zip ＋ edit-summary.md
  └ render.mjs ………… .chaincut.zip → 完成 MP4（H.264 / AAC）
参考動画・スクショ
  └ trace.mjs ………… カットのテンポ・色・音の数値＋代表フレーム
  └ Claude が styles/<名前>.json を書く（テロップの spec と演出ルール）
  └ preview_style.mjs … 参考フレームと並べて答え合わせ
```

## 必要なもの

- ffmpeg / ffprobe
- Node 20 以上と Playwright（`npm i playwright@1.56.1 && npx playwright install chromium`）
- Python 3：`pip install faster-whisper gdown numpy`
- 製品版テロップを透かしなしで出すときは環境変数 `CHAIN_CUT_CODE`（解除コード）

## plan.json の書き方

時刻は **`src`（素材の秒＝文字起こしの時刻）** か **`at`（完成動画の秒）** のどちらかで書く。
`src` で書いておけば、無音カットで詰めたあとの位置に自動で合わせてくれる。

```jsonc
{
  "name": "新商品紹介_ショート",
  "aspect": "9:16",                 // 16:9 / 9:16 / 1:1
  "fps": 30,
  "style": "factory/chain-cut/styles/shorts-variety-pop.json",   // 省略可。演出の型
  "media": { "main": "work/src/talk.mp4", "bgm": "work/src/bgm.mp3", "logo": "work/src/logo.png" },

  // カット：keep で残す区間を直接書くか、silenceCut で無音を自動で詰める
  "sequence": [
    { "media": "main", "silenceCut": { "threshold": -38, "minSilence": 0.45, "pad": 0.08 }, "jumpCutZoom": 1.08 }
    // { "media": "main", "keep": [[0.0, 4.2], [5.1, 12.8]] }
  ],

  // テロップ：文字起こしから自動 ＋ 手書き（強調など）
  "telopStyle": { "design": "st-pop-yellow", "anim": "pop", "se": "pop" },
  "telopsFromTranscript": { "file": "work/words.json", "maxChars": 12, "exclude": ["^えー$", "^あの$"] },
  "telops": [
    { "text": "ここ重要！", "src": 12.4, "dur": 1.5, "emphasis": true },
    { "text": "山田 太郎", "sub": "株式会社サンプル 代表", "src": 2.0, "dur": 3, "design": "n-name-dark" }
  ],

  // 演出（メイン映像）：punch / zoomIn / zoomOut / kenburns / shake / look / mono / blur / flash / dip / whip / zoom / slideL / slideUp / spin
  "effects": [
    { "type": "punch", "src": 12.4, "dur": 1.2, "amount": 1.25, "se": "don" },
    { "type": "zoomIn", "src": 30, "dur": 4 },
    { "type": "flash", "src": 45.2, "dur": 0.5, "se": "whoosh" }
  ],

  "overlays": [ { "media": "logo", "at": 0, "dur": 3, "scale": 15, "x": 380, "y": -800, "trIn": { "type": "zoom", "dur": 0.3 } } ],
  "se": [ { "file": "whoosh", "at": 0 }, { "file": "seikai", "src": 58.0, "volume": 0.6 } ],
  "bgm": { "media": "bgm", "volumeDb": -22, "fadeIn": 1, "fadeOut": 2 },
  "look": "vivid"                    // cinema / vivid / retro / mono / bright か fx のオブジェクト
}
```

- 効果音は `apps/chain-cut/se/index.json` の id（pop, pon, pikon, kira, whoosh, swipe, hyun, byun, don, dodon, jan, zun, seikai, buzzer, chin, boing, clap, drumroll, shutter, type）。
  すべて `make_se.py` で合成した自作音源なので自由に使える
- テロップのデザインは `telop/designs.js` の id か、スタイル／プランの `designs` に書いた独自デザイン
- クリップの細かい指定（`kf` キーフレーム、`fx` エフェクト、`trIn`/`trOut` トランジション）も、telops / overlays / sequence[].clip にそのまま書ける

### クリップの表現（Chain Cut 共通）

| キー | 例 | 意味 |
|---|---|---|
| `kf` | `{ "scale": [[0,100,"easeOut"],[1.5,120,"easeInOut"]] }` | キーフレーム（クリップ内の秒, 値, 次までのイージング）。x / y / scale / opacity / rotation |
| `fx` | `{ "brightness":105, "contrast":110, "saturate":130, "hue":0, "grayscale":0, "sepia":0, "blur":0, "vignette":30, "shake":12 }` | 色・質感・揺れ |
| `trIn` / `trOut` | `{ "type":"flash", "dur":0.2 }` | zoom / zoomOut / slideL / slideUp / whip / spin / flash / dip / blur |
| `anim`（テロップ） | `"pop"` | none / pop / slideUp / slideLeft / wipe / type |

## スタイル（styles/*.json）

参考動画をトレースした「演出の型」。plan の `style` に指定すると下敷きになる（plan に書いた値が優先）。

```jsonc
{
  "name": "…", "description": "…", "aspect": "9:16",
  "designs": [ /* テロップの spec（telop/designs.js と同じ形。フォントは FONTS にあるものだけ） */ ],
  "telop": { "design": "…", "anim": "pop", "se": "pop", "maxChars": 12, "y": 0, "scale": 100,
             "emphasisDesign": "…", "emphasisAnim": "pop", "emphasisSe": "don" },
  "cut": { "silenceCut": { "threshold": -38, "minSilence": 0.4, "pad": 0.06 }, "jumpCutZoom": 1.08, "transition": null },
  "bgm": { "volumeDb": -22 },
  "look": "vivid"
}
```

## 注意

- YouTube / TikTok などから動画を自動ダウンロードしない（各サービスの規約違反）。参考は画面録画・スクショ・自社動画ファイルで受け取る
- トレースは「雰囲気・構成・テンポ」まで。番組ロゴ・局名・固有のキャラクターや他人の素材はコピーしない
- 素材や完成動画はリポジトリに入れない（`work/` は .gitignore 済み）
