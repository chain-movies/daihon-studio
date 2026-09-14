/* =====================================================================
   テロップデザイン定義
   - 1デザイン = 1 spec。variants は色違い（部分上書き）
   - pack でパック（商品）に紐づける。factory/calendar.json が参照する
   - フォントは全て Google Fonts (SIL OFL / Apache) のもののみ使用
   ===================================================================== */
(function (global) {
  'use strict';

  // Google Fonts 読み込み用（family: 必要ウェイト）
  // 各フォントの google/fonts リポジトリ内ファイル（factory/fetch_fonts.mjs がローカルキャッシュを作る）
  const FONTS = {
    'Noto Sans JP': { weights: ['700', '900'], files: [{ w: '100 900', p: 'ofl/notosansjp/NotoSansJP[wght].ttf' }] },
    'Dela Gothic One': { weights: ['400'], files: [{ w: '400', p: 'ofl/delagothicone/DelaGothicOne-Regular.ttf' }] },
    'M PLUS 1p': { weights: ['800', '900'], files: [{ w: '800', p: 'ofl/mplus1p/MPLUS1p-ExtraBold.ttf' }, { w: '900', p: 'ofl/mplus1p/MPLUS1p-Black.ttf' }] },
    'Zen Kaku Gothic New': { weights: ['700', '900'], files: [{ w: '700', p: 'ofl/zenkakugothicnew/ZenKakuGothicNew-Bold.ttf' }, { w: '900', p: 'ofl/zenkakugothicnew/ZenKakuGothicNew-Black.ttf' }] },
    'Zen Maru Gothic': { weights: ['700', '900'], files: [{ w: '700', p: 'ofl/zenmarugothic/ZenMaruGothic-Bold.ttf' }, { w: '900', p: 'ofl/zenmarugothic/ZenMaruGothic-Black.ttf' }] },
    'Zen Old Mincho': { weights: ['900'], files: [{ w: '900', p: 'ofl/zenoldmincho/ZenOldMincho-Black.ttf' }] },
    'Zen Antique Soft': { weights: ['400'], files: [{ w: '400', p: 'ofl/zenantiquesoft/ZenAntiqueSoft-Regular.ttf' }] },
    'Shippori Mincho B1': { weights: ['800'], files: [{ w: '800', p: 'ofl/shipporiminchob1/ShipporiMinchoB1-ExtraBold.ttf' }] },
    'Shippori Antique B1': { weights: ['400'], files: [{ w: '400', p: 'ofl/shipporiantiqueb1/ShipporiAntiqueB1-Regular.ttf' }] },
    'Kaisei Decol': { weights: ['700'], files: [{ w: '700', p: 'ofl/kaiseidecol/KaiseiDecol-Bold.ttf' }] },
    'RocknRoll One': { weights: ['400'], files: [{ w: '400', p: 'ofl/rocknrollone/RocknRollOne-Regular.ttf' }] },
    'Reggae One': { weights: ['400'], files: [{ w: '400', p: 'ofl/reggaeone/ReggaeOne-Regular.ttf' }] },
    'Rampart One': { weights: ['400'], files: [{ w: '400', p: 'ofl/rampartone/RampartOne-Regular.ttf' }] },
    'Mochiy Pop One': { weights: ['400'], files: [{ w: '400', p: 'ofl/mochiypopone/MochiyPopOne-Regular.ttf' }] },
    'Yusei Magic': { weights: ['400'], files: [{ w: '400', p: 'ofl/yuseimagic/YuseiMagic-Regular.ttf' }] },
    'DotGothic16': { weights: ['400'], files: [{ w: '400', p: 'ofl/dotgothic16/DotGothic16-Regular.ttf' }] },
    'Potta One': { weights: ['400'], files: [{ w: '400', p: 'ofl/pottaone/PottaOne-Regular.ttf' }] },
    'Train One': { weights: ['400'], files: [{ w: '400', p: 'ofl/trainone/TrainOne-Regular.ttf' }] },
    'Hachi Maru Pop': { weights: ['400'], files: [{ w: '400', p: 'ofl/hachimarupop/HachiMaruPop-Regular.ttf' }] },
    'Kiwi Maru': { weights: ['500'], files: [{ w: '500', p: 'ofl/kiwimaru/KiwiMaru-Medium.ttf' }] },
    'BIZ UDPGothic': { weights: ['700'], files: [{ w: '700', p: 'ofl/bizudpgothic/BIZUDPGothic-Bold.ttf' }] },
    'Yuji Syuku': { weights: ['400'], files: [{ w: '400', p: 'ofl/yujisyuku/YujiSyuku-Regular.ttf' }] },
    'Klee One': { weights: ['600'], files: [{ w: '600', p: 'ofl/kleeone/KleeOne-SemiBold.ttf' }] },
    'Stick': { weights: ['400'], files: [{ w: '400', p: 'ofl/stick/Stick-Regular.ttf' }] },
  };

  function googleFontsHref() {
    const fam = Object.entries(FONTS).map(([f, v]) => `family=${f.replace(/ /g, '+')}:wght@${v.weights.join(';')}`).join('&');
    return `https://fonts.googleapis.com/css2?${fam}&display=swap`;
  }

  const solid = (color) => ({ type: 'solid', color });
  const grad = (stops, angle) => ({ type: 'gradient', stops, angle: angle == null ? 90 : angle });
  const GOLD = grad([[0, '#fff6c2'], [0.35, '#f5d060'], [0.55, '#b8860b'], [0.75, '#f7dc6f'], [1, '#8a5a00']]);
  const SILVER = grad([[0, '#ffffff'], [0.4, '#d9dde3'], [0.6, '#8d95a1'], [0.8, '#e6e9ee'], [1, '#6c7480']]);
  const BRONZE = grad([[0, '#ffd9b3'], [0.45, '#c97b3a'], [0.65, '#7a3f12'], [1, '#e0a06a']]);

  const DESIGNS = [
    /* 1 */ {
      id: 'variety-tsukkomi', pack: 'tv-vol1', category: 'バラエティ', name: 'バラエティ・ツッコミ',
      sample: 'それ絶対ウソでしょ！',
      font: { family: 'Dela Gothic One', weight: 400, size: 104, letterSpacing: 0.01 },
      fill: grad([[0, '#fffbc4'], [0.45, '#ffd400'], [1, '#ff9a00']]),
      strokes: [{ width: 7, color: '#111111' }, { width: 16, color: '#ffffff' }],
      shadow: { dx: 7, dy: 7, blur: 0, color: 'rgba(0,0,0,0.55)' },
      anchor: { x: 'center', y: 'bottom', margin: 90 },
      variants: [
        { name: 'イエロー' },
        { name: 'ピンク', fill: grad([[0, '#ffe3f0'], [0.45, '#ff5fa8'], [1, '#e6007e']]) },
        { name: 'ブルー', fill: grad([[0, '#dff4ff'], [0.45, '#3fb6ff'], [1, '#0064d2']]) },
        { name: 'グリーン', fill: grad([[0, '#e9ffd9'], [0.45, '#7be04a'], [1, '#1d9a2e']]) },
      ],
    },
    /* 2 */ {
      id: 'variety-odoroki', pack: 'tv-vol1', category: 'バラエティ', name: 'バラエティ・驚き',
      sample: 'えっ、マジで！？',
      font: { family: 'Reggae One', weight: 400, size: 112, letterSpacing: 0.02 },
      fill: solid('#ffffff'),
      strokes: [{ width: 9, color: '#d7002b' }],
      extrude: { depth: 9, dx: 1, dy: 1, color: '#6d0016' },
      shadow: { dx: 4, dy: 8, blur: 10, color: 'rgba(0,0,0,0.45)' },
      variants: [
        { name: 'レッド' },
        { name: 'ブルー', strokes: [{ width: 9, color: '#0050c8' }], extrude: { depth: 9, dx: 1, dy: 1, color: '#062a6b' } },
        { name: 'パープル', strokes: [{ width: 9, color: '#7a1fbf' }], extrude: { depth: 9, dx: 1, dy: 1, color: '#3b0c63' } },
        { name: 'ブラック', strokes: [{ width: 9, color: '#111111' }], extrude: { depth: 9, dx: 1, dy: 1, color: '#555555' }, fill: solid('#ffe600') },
      ],
    },
    /* 3 */ {
      id: 'news-flash', pack: 'tv-vol1', category: 'ニュース', name: 'ニュース速報',
      sample: '〇〇市で震度4を観測 津波の心配なし',
      font: { family: 'Noto Sans JP', weight: 900, size: 66, letterSpacing: 0.02 },
      fill: solid('#ffffff'),
      box: { type: 'bar', fill: solid('#b7001e'), padY: 20, stroke: { width: 4, color: '#ffffff' } },
      tag: { text: '速報', font: { family: 'Noto Sans JP', weight: 900, size: 50 }, fill: solid('#b7001e'), box: { type: 'rect', fill: solid('#ffffff') }, padX: 20, padY: 6, gap: 28, keepOnPlate: true },
      anchor: { x: 'left', y: 'bottom', margin: 80 },
      portraitScale: 0.72,
      variants: [
        { name: 'レッド' },
        { name: 'ネイビー', box: { fill: solid('#0b2a5b') }, tag: { fill: solid('#0b2a5b') } },
        { name: 'ブラック', box: { fill: solid('#111111'), stroke: { width: 4, color: '#ffd400' } }, tag: { fill: solid('#111111'), box: { fill: solid('#ffd400') } } },
      ],
    },
    /* 4 */ {
      id: 'news-name', pack: 'tv-vol1', category: 'ニュース', name: 'ニュース・名前テロップ',
      sample: '山田 太郎', sampleSub: '株式会社サンプル 代表取締役',
      font: { family: 'Noto Sans JP', weight: 900, size: 64, letterSpacing: 0.06 },
      fill: solid('#111111'),
      box: { type: 'tagleft', fill: solid('#ffffff'), padX: 40, padY: 12, accent: { side: 'left', width: 18, color: '#0b2a5b' }, shadow: { dx: 0, dy: 6, blur: 14, color: 'rgba(0,0,0,0.35)' }, minWidth: 520 },
      sub: { position: 'above', align: 'left', indent: 0, gap: 0, font: { family: 'Noto Sans JP', weight: 700, size: 30, letterSpacing: 0.05 }, fill: solid('#ffffff'), box: { type: 'rect', fill: solid('#0b2a5b') }, lineHeight: 1.4 },
      anchor: { x: 'left', y: 'bottom', margin: 90 },
      variants: [
        { name: 'ネイビー' },
        { name: 'レッド', box: { accent: { color: '#c8102e' } }, sub: { box: { fill: solid('#c8102e') } } },
        { name: 'グリーン', box: { accent: { color: '#008a5e' } }, sub: { box: { fill: solid('#008a5e') } } },
        { name: 'ダーク', box: { fill: solid('#1b1b1b'), accent: { color: '#ffb400' } }, fill: solid('#ffffff'), sub: { box: { fill: solid('#ffb400') }, fill: solid('#1b1b1b') } },
      ],
    },
    /* 5 */ {
      id: 'wideshow', pack: 'tv-vol1', category: '情報番組', name: '情報番組・ワイドショー',
      sample: '今週末は全国的に晴れ 行楽日和に',
      font: { family: 'M PLUS 1p', weight: 900, size: 78, letterSpacing: 0.02 },
      fill: solid('#ffffff'),
      strokes: [{ width: 6, color: '#3a1d00' }],
      box: { type: 'skew', skew: 26, fill: grad([[0, '#ff8a00'], [1, '#ffc400']], 0), padX: 48, padY: 16, accent: { side: 'bottom', width: 10, color: '#ffffff' }, shadow: { dx: 0, dy: 8, blur: 16, color: 'rgba(0,0,0,0.35)' } },
      portraitScale: 0.7,
      variants: [
        { name: 'オレンジ' },
        { name: 'ブルー', box: { fill: grad([[0, '#0050c8'], [1, '#2ec4ff']], 0) }, strokes: [{ width: 6, color: '#001a4a' }] },
        { name: 'グリーン', box: { fill: grad([[0, '#0a8f3c'], [1, '#8ee000']], 0) }, strokes: [{ width: 6, color: '#0a3d15' }] },
        { name: 'ピンク', box: { fill: grad([[0, '#e6007e'], [1, '#ff8ac2']], 0) }, strokes: [{ width: 6, color: '#5a0033' }] },
      ],
    },
    /* 6 */ {
      id: 'documentary', pack: 'tv-vol1', category: 'ドキュメンタリー', name: 'ドキュメンタリー・明朝',
      sample: 'そして、彼は海へ向かった。',
      font: { family: 'Shippori Mincho B1', weight: 800, size: 74, letterSpacing: 0.1 },
      fill: solid('#ffffff'),
      shadow: { dx: 0, dy: 3, blur: 14, color: 'rgba(0,0,0,0.85)' },
      box: { type: 'underline', thickness: 3, fill: solid('rgba(255,255,255,0.85)'), padX: 20, padY: 18 },
      variants: [
        { name: 'ホワイト' },
        { name: 'ゴールド', fill: GOLD, box: { fill: solid('#d4b458') } },
        { name: 'ブラック', fill: solid('#111111'), shadow: { dx: 0, dy: 0, blur: 12, color: 'rgba(255,255,255,0.9)' }, box: { fill: solid('#111111') } },
      ],
    },
    /* 7 */ {
      id: 'quiz-gold', pack: 'tv-vol1', category: 'クイズ', name: 'クイズ・ゴールド',
      sample: '日本で一番高い山は？',
      font: { family: 'Kaisei Decol', weight: 700, size: 88, letterSpacing: 0.04 },
      fill: GOLD,
      strokes: [{ width: 5, color: '#3b2200' }],
      extrude: { depth: 8, dx: 1, dy: 1.2, color: '#4a2f00' },
      shadow: { dx: 0, dy: 10, blur: 14, color: 'rgba(0,0,0,0.5)' },
      box: { type: 'round', radius: 22, fill: grad([[0, '#0b1b3a'], [1, '#04101f']]), padX: 56, padY: 26, stroke: { width: 5, color: '#e6c25a' }, innerLine: { gap: 10, width: 2, color: 'rgba(230,194,90,0.8)' } },
      tag: { text: 'Q', position: 'left', font: { family: 'Kaisei Decol', weight: 700, size: 64 }, fill: GOLD, strokes: [{ width: 3, color: '#3b2200' }], box: { type: 'none' }, padX: 8, padY: 0, gap: 20 },
      portraitScale: 0.7,
      variants: [
        { name: 'ゴールド' },
        { name: 'シルバー', fill: SILVER, tag: { fill: SILVER }, box: { stroke: { color: '#cfd6df' }, innerLine: { color: 'rgba(207,214,223,0.8)' } } },
        { name: 'ブロンズ', fill: BRONZE, tag: { fill: BRONZE }, box: { stroke: { color: '#c97b3a' }, innerLine: { color: 'rgba(201,123,58,0.8)' } } },
      ],
    },
    /* 8 */ {
      id: 'travel', pack: 'tv-vol1', category: '旅', name: '旅番組・ゆる旅',
      sample: '絶景の露天風呂へ', sampleSub: '静岡・熱海',
      font: { family: 'Zen Maru Gothic', weight: 900, size: 84, letterSpacing: 0.04 },
      fill: solid('#5a3e2b'),
      box: { type: 'pill', fill: solid('#fff6e5'), padX: 60, padY: 14, stroke: { width: 5, color: '#e2b98a' }, shadow: { dx: 0, dy: 8, blur: 14, color: 'rgba(0,0,0,0.3)' } },
      sub: { position: 'above', align: 'left', indent: 40, gap: 6, font: { family: 'Zen Maru Gothic', weight: 900, size: 34 }, fill: solid('#ffffff'), box: { type: 'pill', fill: solid('#e0813a') }, lineHeight: 1.45 },
      variants: [
        { name: 'クリーム' },
        { name: 'ミント', box: { fill: solid('#eafff5'), stroke: { color: '#7fd8b0' } }, fill: solid('#1f5a44'), sub: { box: { fill: solid('#2aa57a') } } },
        { name: 'スカイ', box: { fill: solid('#eaf6ff'), stroke: { color: '#8ec9ff' } }, fill: solid('#1c4f80'), sub: { box: { fill: solid('#3d8ee0') } } },
        { name: 'ピーチ', box: { fill: solid('#fff0f3'), stroke: { color: '#ffb0c2' } }, fill: solid('#7a2b45'), sub: { box: { fill: solid('#ff6f91') } } },
      ],
    },
    /* 9 */ {
      id: 'gourmet-brush', pack: 'tv-vol1', category: 'グルメ', name: 'グルメ・筆文字',
      sample: '極上の一杯',
      font: { family: 'Yuji Syuku', weight: 400, size: 110, letterSpacing: 0.08 },
      fill: solid('#ffffff'),
      shadow: { dx: 3, dy: 3, blur: 4, color: 'rgba(0,0,0,0.5)' },
      box: { type: 'brush', jitter: 7, fill: solid('#b3121b'), padX: 54, padY: 10, shadow: { dx: 0, dy: 6, blur: 12, color: 'rgba(0,0,0,0.4)' } },
      variants: [
        { name: '朱' },
        { name: '墨', box: { fill: solid('#1b1b1b') }, fill: GOLD },
        { name: '藍', box: { fill: solid('#1c3f6e') } },
        { name: '白', box: { fill: solid('#f8f4ea') }, fill: solid('#1b1b1b'), shadow: null },
      ],
    },
    /* 10 */ {
      id: 'horror', pack: 'tv-vol1', category: 'ホラー', name: 'ホラー・心霊',
      sample: 'その夜、何かがいた',
      font: { family: 'Shippori Antique B1', weight: 400, size: 92, letterSpacing: 0.12 },
      fill: solid('#e9e4e4'),
      strokes: [{ width: 3, color: '#4a0000' }],
      glow: { color: 'rgba(200,0,0,0.9)', blur: 30, strength: 3 },
      shadow: { dx: 0, dy: 0, blur: 24, color: 'rgba(0,0,0,0.9)' },
      variants: [
        { name: '赤' },
        { name: '青白', glow: { color: 'rgba(80,160,255,0.9)', blur: 30, strength: 3 }, strokes: [{ width: 3, color: '#00224a' }] },
        { name: '緑', glow: { color: 'rgba(40,220,80,0.9)', blur: 30, strength: 3 }, strokes: [{ width: 3, color: '#003a10' }] },
      ],
    },
    /* 11 */ {
      id: 'sports', pack: 'tv-vol1', category: 'スポーツ', name: 'スポーツ・速報',
      sample: '逆転ゴール！', sampleSub: '後半 42分',
      font: { family: 'Noto Sans JP', weight: 900, size: 92, letterSpacing: 0.02, skew: 12 },
      fill: solid('#ffffff'),
      strokes: [{ width: 6, color: '#00205b' }],
      box: { type: 'skew', skew: 30, fill: grad([[0, '#0033a0'], [1, '#00a3ff']], 0), padX: 56, padY: 14, accent: { side: 'bottom', width: 12, color: '#ffe600' }, shadow: { dx: 0, dy: 8, blur: 14, color: 'rgba(0,0,0,0.4)' } },
      sub: { position: 'above', align: 'left', indent: 30, gap: 4, font: { family: 'Noto Sans JP', weight: 900, size: 34, skew: 12 }, fill: solid('#00205b'), box: { type: 'skew', skew: 12, fill: solid('#ffe600') }, lineHeight: 1.4 },
      variants: [
        { name: 'ブルー' },
        { name: 'レッド', box: { fill: grad([[0, '#a80000'], [1, '#ff5a36']], 0) }, strokes: [{ width: 6, color: '#4a0000' }], sub: { fill: solid('#4a0000') } },
        { name: 'グリーン', box: { fill: grad([[0, '#006d2c'], [1, '#5ad25a']], 0) }, strokes: [{ width: 6, color: '#003a15' }], sub: { fill: solid('#003a15') } },
        { name: 'ブラック', box: { fill: grad([[0, '#111111'], [1, '#444444']], 0) }, strokes: [{ width: 6, color: '#000000' }], sub: { fill: solid('#111111') } },
      ],
    },
    /* 12 */ {
      id: 'romance', pack: 'tv-vol1', category: '恋愛', name: '恋愛リアリティ',
      sample: '胸キュンが止まらない',
      font: { family: 'Yusei Magic', weight: 400, size: 96, letterSpacing: 0.03 },
      fill: solid('#ff4f8b'),
      strokes: [{ width: 10, color: '#ffffff' }],
      shadow: { dx: 0, dy: 6, blur: 14, color: 'rgba(255,80,140,0.45)' },
      deco: [{ type: 'sparkle', color: '#ffd6e6', size: 20, points: [[0.02, 0.1], [0.97, 0.15], [0.9, 0.95]] }],
      variants: [
        { name: 'ピンク' },
        { name: 'ラベンダー', fill: solid('#8a5cf6'), shadow: { dx: 0, dy: 6, blur: 14, color: 'rgba(138,92,246,0.45)' }, deco: [{ type: 'sparkle', color: '#e7dcff', size: 20, points: [[0.02, 0.1], [0.97, 0.15], [0.9, 0.95]] }] },
        { name: 'ミント', fill: solid('#1fb89a'), shadow: { dx: 0, dy: 6, blur: 14, color: 'rgba(31,184,154,0.45)' }, deco: [{ type: 'sparkle', color: '#d4fff4', size: 20, points: [[0.02, 0.1], [0.97, 0.15], [0.9, 0.95]] }] },
      ],
    },
    /* 13 */ {
      id: 'music-neon', pack: 'tv-vol1', category: '音楽', name: '音楽番組・ネオン',
      sample: '今夜、伝説になる',
      font: { family: 'Zen Kaku Gothic New', weight: 700, size: 92, letterSpacing: 0.1 },
      fill: solid('#ffffff'),
      strokes: [{ width: 3, color: '#ff2bd6' }],
      glow: { color: 'rgba(255,43,214,0.95)', blur: 36, strength: 3 },
      variants: [
        { name: 'ピンク' },
        { name: 'シアン', strokes: [{ width: 3, color: '#19e6ff' }], glow: { color: 'rgba(25,230,255,0.95)', blur: 36, strength: 3 } },
        { name: 'イエロー', strokes: [{ width: 3, color: '#ffe600' }], glow: { color: 'rgba(255,230,0,0.95)', blur: 36, strength: 3 } },
        { name: 'グリーン', strokes: [{ width: 3, color: '#39ff6a' }], glow: { color: 'rgba(57,255,106,0.95)', blur: 36, strength: 3 } },
      ],
    },
    /* 14 */ {
      id: 'kids-pop', pack: 'tv-vol1', category: '教育・キッズ', name: '教育・キッズポップ',
      sample: 'みんなでチャレンジ！',
      font: { family: 'Mochiy Pop One', weight: 400, size: 96, letterSpacing: 0.02 },
      fill: grad([[0, '#ff6b6b'], [0.33, '#ffb84d'], [0.66, '#5ccc7a'], [1, '#4d96ff']], 0),
      strokes: [{ width: 9, color: '#ffffff' }, { width: 15, color: '#3a3a3a' }],
      shadow: { dx: 5, dy: 6, blur: 0, color: 'rgba(0,0,0,0.35)' },
      variants: [
        { name: 'レインボー' },
        { name: 'オレンジ', fill: grad([[0, '#ffe08a'], [1, '#ff8a00']]) },
        { name: 'グリーン', fill: grad([[0, '#c8ff9a'], [1, '#2bb34a']]) },
        { name: 'ブルー', fill: grad([[0, '#bfe9ff'], [1, '#2a7bff']]) },
      ],
    },
    /* 15 */ {
      id: 'business', pack: 'tv-vol1', category: 'ビジネス・経済', name: 'ビジネス・経済',
      sample: '売上を2倍にする3つの施策', sampleSub: 'POINT 01',
      font: { family: 'Noto Sans JP', weight: 700, size: 62, letterSpacing: 0.04 },
      fill: solid('#ffffff'),
      box: { type: 'tagleft', skew: 26, fill: solid('#0b1f3a'), padX: 44, padY: 18, accent: { side: 'left', width: 16, color: '#ffb400' }, shadow: { dx: 0, dy: 6, blur: 14, color: 'rgba(0,0,0,0.35)' } },
      sub: { position: 'above', align: 'left', indent: 26, gap: 0, font: { family: 'Noto Sans JP', weight: 900, size: 28, letterSpacing: 0.18 }, fill: solid('#0b1f3a'), box: { type: 'rect', fill: solid('#ffb400') }, lineHeight: 1.4 },
      anchor: { x: 'left', y: 'bottom', margin: 90 },
      variants: [
        { name: 'ネイビー' },
        { name: 'ブラック', box: { fill: solid('#141414'), accent: { color: '#e60012' } }, sub: { fill: solid('#ffffff'), box: { fill: solid('#e60012') } } },
        { name: 'ホワイト', box: { fill: solid('#ffffff'), accent: { color: '#0b1f3a' } }, fill: solid('#0b1f3a'), sub: { fill: solid('#ffffff'), box: { fill: solid('#0b1f3a') } } },
      ],
    },
    /* 16 */ {
      id: 'retro-showa', pack: 'tv-vol1', category: 'レトロ', name: '昭和レトロ・版ずれ',
      sample: '懐かしの名曲特集',
      font: { family: 'Kaisei Decol', weight: 700, size: 96, letterSpacing: 0.06 },
      fill: solid('#f7ecd2'),
      strokes: [{ width: 7, color: '#2b2b2b' }],
      shadow: { dx: 9, dy: 9, blur: 0, color: '#d94f2b' },
      variants: [
        { name: 'クリーム×朱' },
        { name: 'ミント×紺', fill: solid('#bfeee0'), shadow: { dx: 9, dy: 9, blur: 0, color: '#1e3a6e' } },
        { name: 'レモン×茶', fill: solid('#fff1a8'), shadow: { dx: 9, dy: 9, blur: 0, color: '#6b4a2b' } },
      ],
    },
    /* 17 */ {
      id: 'drama-suspense', pack: 'tv-vol1', category: 'ドラマ', name: 'サスペンス・ドラマ帯',
      sample: '事件は、まだ終わっていない',
      font: { family: 'Zen Old Mincho', weight: 900, size: 66, letterSpacing: 0.14 },
      fill: solid('#ffffff'),
      align: 'center',
      box: { type: 'bar', fill: solid('rgba(0,0,0,0.78)'), padY: 26 },
      variants: [
        { name: 'ブラック' },
        { name: 'ホワイト', box: { fill: solid('rgba(255,255,255,0.9)') }, fill: solid('#111111') },
        { name: 'ワインレッド', box: { fill: solid('rgba(90,0,20,0.85)') } },
      ],
    },
    /* 18 */ {
      id: 'game-window', pack: 'tv-vol1', category: 'ゲーム', name: 'ゲーム実況・RPGウィンドウ',
      sample: 'ボスが あらわれた！',
      font: { family: 'DotGothic16', weight: 400, size: 88, letterSpacing: 0.06 },
      fill: solid('#ffffff'),
      box: { type: 'round', radius: 10, fill: solid('rgba(16,20,60,0.92)'), padX: 60, padY: 30, stroke: { width: 6, color: '#ffffff' }, innerLine: { gap: 10, width: 3, color: '#ffffff' } },
      variants: [
        { name: 'ホワイト' },
        { name: 'グリーン', fill: solid('#7cff6b') },
        { name: 'イエロー', fill: solid('#ffe94d') },
        { name: 'シアン', fill: solid('#5ff2ff') },
      ],
    },
    /* 19 */ {
      id: 'shopping', pack: 'tv-vol1', category: '通販', name: '通販・お得感',
      sample: 'なんと半額！',
      font: { family: 'RocknRoll One', weight: 400, size: 108, letterSpacing: 0.02 },
      fill: solid('#ffffff'),
      strokes: [{ width: 8, color: '#e60012' }, { width: 14, color: '#ffffff' }],
      shadow: { dx: 6, dy: 6, blur: 0, color: 'rgba(0,0,0,0.4)' },
      box: { type: 'skew', skew: 22, fill: solid('#ffd800'), padX: 70, padY: 12 },
      tag: { text: '今だけ', position: 'left', font: { family: 'RocknRoll One', weight: 400, size: 44 }, fill: solid('#ffffff'), box: { type: 'pill', fill: solid('#e60012') }, padX: 22, padY: 8, gap: 22 },
      variants: [
        { name: 'レッド×イエロー' },
        { name: 'ブルー×イエロー', strokes: [{ width: 8, color: '#0050c8' }, { width: 14, color: '#ffffff' }], tag: { box: { fill: solid('#0050c8') } } },
        { name: 'ピンク×ホワイト', strokes: [{ width: 8, color: '#e6007e' }, { width: 14, color: '#ffffff' }], box: { fill: solid('#ffffff') }, tag: { box: { fill: solid('#e6007e') } } },
      ],
    },
    /* 20 */ {
      id: 'weather', pack: 'tv-vol1', category: 'お天気', name: 'お天気コーナー',
      sample: 'あすは全国的に晴れ',
      font: { family: 'Kiwi Maru', weight: 500, size: 78, letterSpacing: 0.03 },
      fill: solid('#1b4b7a'),
      box: { type: 'round', radius: 30, fill: solid('#eaf7ff'), padX: 54, padY: 16, stroke: { width: 5, color: '#8ed0ff' }, shadow: { dx: 0, dy: 8, blur: 14, color: 'rgba(0,0,0,0.25)' } },
      tag: { text: '天気', position: 'left', font: { family: 'Kiwi Maru', weight: 500, size: 40 }, fill: solid('#ffffff'), box: { type: 'pill', fill: solid('#3d8ee0') }, padX: 22, padY: 8, gap: 22 },
      variants: [
        { name: 'スカイ' },
        { name: 'サンセット', box: { fill: solid('#fff3e6'), stroke: { color: '#ffb877' } }, fill: solid('#8a3c00'), tag: { box: { fill: solid('#ff8a3d') } } },
        { name: 'レイン', box: { fill: solid('#eef0ff'), stroke: { color: '#a9b1ff' } }, fill: solid('#2f3a8a'), tag: { box: { fill: solid('#5c6bff') } } },
      ],
    },
    /* 21 */ {
      id: 'vlog-natural', pack: 'tv-vol1', category: 'Vlog', name: 'Vlog・ナチュラル',
      sample: '今日は朝からカフェ巡り',
      font: { family: 'Zen Kaku Gothic New', weight: 700, size: 60, letterSpacing: 0.08 },
      fill: solid('#ffffff'),
      shadow: { dx: 0, dy: 2, blur: 12, color: 'rgba(0,0,0,0.6)' },
      deco: [{ type: 'sideBars', color: 'rgba(255,255,255,0.9)', thickness: 3, gap: 28 }],
      variants: [
        { name: 'ホワイト' },
        { name: 'ベージュ', fill: solid('#f3e5c9'), deco: [{ type: 'sideBars', color: 'rgba(243,229,201,0.9)', thickness: 3, gap: 28 }] },
        { name: 'ブラック', fill: solid('#1b1b1b'), shadow: { dx: 0, dy: 0, blur: 10, color: 'rgba(255,255,255,0.85)' }, deco: [{ type: 'sideBars', color: '#1b1b1b', thickness: 3, gap: 28 }] },
      ],
    },
    /* 22 */ {
      id: 'history-jidai', pack: 'tv-vol1', category: '歴史・時代劇', name: '歴史・時代劇',
      sample: '天下分け目の戦い',
      font: { family: 'Yuji Syuku', weight: 400, size: 104, letterSpacing: 0.1 },
      fill: GOLD,
      strokes: [{ width: 4, color: '#2a1a00' }],
      shadow: { dx: 4, dy: 4, blur: 6, color: 'rgba(0,0,0,0.6)' },
      box: { type: 'brush', jitter: 5, fill: solid('rgba(20,16,12,0.9)'), padX: 60, padY: 14 },
      deco: [{ type: 'lineTop', color: '#d4b458', thickness: 3, gap: 10 }, { type: 'lineBottom', color: '#d4b458', thickness: 3, gap: 10 }],
      variants: [
        { name: '金' },
        { name: '朱', fill: solid('#ffffff'), box: { fill: solid('rgba(150,20,20,0.92)') }, deco: [{ type: 'lineTop', color: '#ffffff', thickness: 3, gap: 10 }, { type: 'lineBottom', color: '#ffffff', thickness: 3, gap: 10 }] },
        { name: '白', fill: solid('#1b1b1b'), strokes: [], box: { fill: solid('rgba(248,244,234,0.95)') }, deco: [{ type: 'lineTop', color: '#1b1b1b', thickness: 3, gap: 10 }, { type: 'lineBottom', color: '#1b1b1b', thickness: 3, gap: 10 }] },
      ],
    },
  ];

  const PACKS = {
    'tv-vol1': { name: 'テレビ番組風テロップ素材集 Vol.1', short: 'TV風テロップ Vol.1', price: 1980 },
  };

  const API = { DESIGNS, PACKS, FONTS, googleFontsHref };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.TelopDesigns = API;
})(typeof window !== 'undefined' ? window : globalThis);
