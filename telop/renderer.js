/* =====================================================================
   Telop Renderer — spec(JSON) → Canvas 2D
   ブラウザ(テロップメーカー)と factory/build_pack.mjs(Playwright) の両方で
   全く同じ描画を行う共通モジュール。依存なし。
   ===================================================================== */
(function (global) {
  'use strict';

  const DEFAULTS = {
    font: { family: 'Noto Sans JP', weight: 900, size: 96, letterSpacing: 0, skew: 0, italic: false },
    lineHeight: 1.18,
    fill: { type: 'solid', color: '#ffffff' },
    strokes: [],
    shadow: null,
    extrude: null,
    glow: null,
    box: null,
    tag: null,
    sub: null,
    anchor: { x: 'center', y: 'bottom', margin: 90 },
  };

  function deepMerge(base, over) {
    if (over === undefined) return clone(base);
    if (over === null) return null;
    if (Array.isArray(over) || typeof over !== 'object') return clone(over);
    const out = (base && typeof base === 'object' && !Array.isArray(base)) ? clone(base) : {};
    for (const k of Object.keys(over)) out[k] = deepMerge(out[k], over[k]);
    return out;
  }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  /** デザイン + バリアント を解決して完全なスペックにする */
  function resolve(design, variantIndex) {
    let spec = deepMerge(DEFAULTS, design);
    if (design.variants && design.variants.length && variantIndex != null) {
      const v = design.variants[variantIndex] || design.variants[0];
      const { name, ...rest } = v;
      spec = deepMerge(spec, rest);
      spec.variantName = name;
    }
    return spec;
  }

  function fontString(f, scale) {
    const size = Math.round(f.size * (scale || 1));
    return `${f.italic ? 'italic ' : ''}${f.weight || 400} ${size}px "${f.family}"`;
  }

  async function ensureFonts(spec, texts) {
    if (typeof document === 'undefined' || !document.fonts) return;
    const jobs = [];
    const sample = (texts || []).join('') || 'テロップ素材サンプルABC123';
    const fams = [spec.font];
    if (spec.sub && spec.sub.font) fams.push(spec.sub.font);
    if (spec.tag && spec.tag.font) fams.push(spec.tag.font);
    for (const f of fams) {
      jobs.push(document.fonts.load(fontString(f), sample).catch(() => {}));
    }
    await Promise.all(jobs);
    try { await document.fonts.ready; } catch (e) { /* ignore */ }
  }

  /* ---------- 塗り生成 ---------- */
  function makePaint(ctx, fill, bounds) {
    if (!fill) return '#fff';
    if (fill.type === 'gradient') {
      const angle = ((fill.angle == null ? 90 : fill.angle) * Math.PI) / 180;
      const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
      const len = Math.abs(bounds.w * Math.sin(angle)) + Math.abs(bounds.h * Math.cos(angle));
      const dx = (Math.sin(angle) * len) / 2, dy = (-Math.cos(angle) * len) / 2;
      const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      for (const [pos, col] of fill.stops) g.addColorStop(pos, col);
      return g;
    }
    if (fill.type === 'stripes') {
      const c = document.createElement('canvas');
      const s = fill.size || 16; c.width = s; c.height = s;
      const p = c.getContext('2d');
      p.fillStyle = fill.a || '#fff'; p.fillRect(0, 0, s, s);
      p.fillStyle = fill.b || '#eee';
      p.beginPath(); p.moveTo(0, s); p.lineTo(s, 0); p.lineTo(s, s / 2); p.lineTo(s / 2, s); p.closePath(); p.fill();
      p.beginPath(); p.moveTo(0, 0); p.lineTo(s / 2, 0); p.lineTo(0, s / 2); p.closePath(); p.fill();
      return ctx.createPattern(c, 'repeat');
    }
    return fill.color || '#fff';
  }

  /* ---------- テキスト計測 ---------- */
  function measureLines(ctx, font, lines, scale) {
    ctx.font = fontString(font, scale);
    const ls = (font.letterSpacing || 0) * font.size * scale;
    const widths = lines.map((l) => {
      let w = 0;
      for (const ch of Array.from(l)) w += ctx.measureText(ch).width + ls;
      return Math.max(0, w - ls);
    });
    return { widths, ls };
  }

  /** 1行を文字送りしながら描く (fill / stroke 共通) */
  function drawLineText(ctx, line, x, y, ls, mode, align) {
    const chars = Array.from(line);
    let total = 0;
    const ws = chars.map((c) => { const w = ctx.measureText(c).width; total += w + ls; return w; });
    total -= ls;
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    ctx.textAlign = 'left';
    for (let i = 0; i < chars.length; i++) {
      if (mode === 'stroke') ctx.strokeText(chars[i], cx, y); else ctx.fillText(chars[i], cx, y);
      cx += ws[i] + ls;
    }
  }

  /* ---------- 文字ブロック描画 ---------- */
  function drawTextBlock(ctx, opts) {
    // opts: {font, lines, x, y(top), scale, fill, strokes, shadow, extrude, glow, align, lineHeight, bounds}
    const { font, lines, scale, align } = opts;
    const size = font.size * scale;
    const lh = (opts.lineHeight || 1.18) * size;
    ctx.save();
    ctx.font = fontString(font, scale);
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.miterLimit = 2;
    const ls = (font.letterSpacing || 0) * size;
    if (font.skew) {
      const k = Math.tan((-font.skew * Math.PI) / 180);
      ctx.transform(1, 0, k, 1, -k * (opts.y + lh / 2), 0);
    }
    const baseY = (i) => opts.y + lh * i + size * 0.86; // ざっくりベースライン
    const strokes = (opts.strokes || []).slice().sort((a, b) => b.width - a.width);
    const paint = makePaint(ctx, opts.fill, opts.bounds);

    const eachLine = (fn) => lines.forEach((l, i) => fn(l, baseY(i)));

    // glow
    if (opts.glow) {
      ctx.save();
      ctx.shadowColor = opts.glow.color; ctx.shadowBlur = opts.glow.blur * scale;
      ctx.fillStyle = opts.glow.color;
      const n = opts.glow.strength || 2;
      for (let k = 0; k < n; k++) eachLine((l, y) => drawLineText(ctx, l, opts.x, y, ls, 'fill', align));
      ctx.restore();
    }
    // shadow — 最外層の描画にだけ影を付ける
    const applyShadow = () => {
      if (!opts.shadow) return;
      ctx.shadowColor = opts.shadow.color; ctx.shadowBlur = (opts.shadow.blur || 0) * scale;
      ctx.shadowOffsetX = (opts.shadow.dx || 0) * scale; ctx.shadowOffsetY = (opts.shadow.dy || 0) * scale;
    };
    const clearShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

    let shadowDone = false;
    // extrude (立体) — 最外ストローク込みでずらしコピー
    if (opts.extrude) {
      const e = opts.extrude;
      ctx.save();
      applyShadow(); shadowDone = true;
      for (let d = e.depth; d >= 1; d--) {
        ctx.save();
        ctx.translate((e.dx == null ? 1 : e.dx) * d * scale, (e.dy == null ? 1 : e.dy) * d * scale);
        if (strokes.length) {
          const s = strokes[0];
          ctx.lineWidth = s.width * 2 * scale; ctx.strokeStyle = e.color;
          eachLine((l, y) => drawLineText(ctx, l, opts.x, y, ls, 'stroke', align));
        }
        ctx.fillStyle = e.color;
        eachLine((l, y) => drawLineText(ctx, l, opts.x, y, ls, 'fill', align));
        ctx.restore();
        clearShadow();
      }
      ctx.restore();
    }
    // strokes outer → inner
    strokes.forEach((s, idx) => {
      ctx.save();
      if (idx === 0 && !shadowDone) { applyShadow(); shadowDone = true; }
      ctx.lineWidth = s.width * 2 * scale;
      ctx.strokeStyle = s.fill ? makePaint(ctx, s.fill, opts.bounds) : s.color;
      eachLine((l, y) => drawLineText(ctx, l, opts.x, y, ls, 'stroke', align));
      ctx.restore();
    });
    // fill
    ctx.save();
    if (!shadowDone) { applyShadow(); shadowDone = true; }
    ctx.fillStyle = paint;
    eachLine((l, y) => drawLineText(ctx, l, opts.x, y, ls, 'fill', align));
    ctx.restore();
    ctx.restore();
  }

  /* ---------- 形状 ---------- */
  function shapePath(ctx, box, r) {
    const { x, y, w, h } = r;
    ctx.beginPath();
    switch (box.type) {
      case 'pill': {
        const rad = h / 2; roundRect(ctx, x, y, w, h, rad); break;
      }
      case 'round': roundRect(ctx, x, y, w, h, box.radius == null ? 18 : box.radius); break;
      case 'skew': {
        const k = box.skew == null ? 18 : box.skew;
        ctx.moveTo(x + k, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - k, y + h); ctx.lineTo(x, y + h); ctx.closePath(); break;
      }
      case 'ribbon': {
        const k = box.notch == null ? h * 0.35 : box.notch;
        ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - k, y + h / 2); ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h); ctx.lineTo(x + k, y + h / 2); ctx.closePath(); break;
      }
      case 'tagleft': { // 左が斜めカット
        const k = box.skew == null ? 22 : box.skew;
        ctx.moveTo(x + k, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); break;
      }
      case 'burst': { // 爆発吹き出し
        const n = box.spikes == null ? 18 : box.spikes, sp = (box.spike == null ? 34 : box.spike);
        const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
        for (let i = 0; i < n * 2; i++) {
          const a = (Math.PI * 2 * i) / (n * 2) - Math.PI / 2;
          const out = i % 2 === 0;
          const jit = out ? 1 : 0.86;
          const px = cx + (rx + (out ? sp : 0)) * Math.cos(a) * jit, py = cy + (ry + (out ? sp : 0)) * Math.sin(a) * jit;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); break;
      }
      case 'speech': { // 角丸吹き出し（左下にしっぽ）
        const rad = box.radius == null ? 24 : box.radius, t = box.tail == null ? 34 : box.tail;
        ctx.moveTo(x + rad, y); ctx.lineTo(x + w - rad, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
        ctx.lineTo(x + w, y + h - rad); ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
        ctx.lineTo(x + w * 0.3, y + h); ctx.lineTo(x + w * 0.2, y + h + t); ctx.lineTo(x + w * 0.16, y + h);
        ctx.lineTo(x + rad, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
        ctx.lineTo(x, y + rad); ctx.quadraticCurveTo(x, y, x + rad, y); ctx.closePath(); break;
      }
      case 'brush': { // ざっくり筆帯風（多角形）
        const j = box.jitter == null ? 6 : box.jitter;
        const pts = [];
        const n = 14;
        for (let i = 0; i <= n; i++) pts.push([x + (w * i) / n, y + Math.sin(i * 1.7) * j]);
        for (let i = n; i >= 0; i--) pts.push([x + (w * i) / n, y + h + Math.cos(i * 1.3) * j]);
        ctx.moveTo(pts[0][0], pts[0][1]); pts.forEach((p) => ctx.lineTo(p[0], p[1])); ctx.closePath(); break;
      }
      default: ctx.rect(x, y, w, h);
    }
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function drawBox(ctx, box, r, scale) {
    if (!box || box.type === 'none') return;
    ctx.save();
    if (box.shadow) {
      ctx.shadowColor = box.shadow.color; ctx.shadowBlur = (box.shadow.blur || 0) * scale;
      ctx.shadowOffsetX = (box.shadow.dx || 0) * scale; ctx.shadowOffsetY = (box.shadow.dy || 0) * scale;
    }
    if (box.type === 'underline') {
      const th = (box.thickness || 6) * scale;
      ctx.fillStyle = makePaint(ctx, box.fill, r);
      ctx.fillRect(r.x, r.y + r.h - th, r.w, th);
      ctx.restore(); return;
    }
    if (box.type === 'bar') { // 画面幅いっぱいの帯
      const full = { x: 0, y: r.y, w: box._canvasW, h: r.h };
      ctx.fillStyle = makePaint(ctx, box.fill, full);
      ctx.fillRect(full.x, full.y, full.w, full.h);
      if (box.stroke) { ctx.fillStyle = box.stroke.color; ctx.fillRect(0, r.y, full.w, box.stroke.width * scale); ctx.fillRect(0, r.y + r.h - box.stroke.width * scale, full.w, box.stroke.width * scale); }
      ctx.restore(); return;
    }
    shapePath(ctx, box, r);
    if (box.fill) { ctx.fillStyle = makePaint(ctx, box.fill, r); ctx.fill(); }
    ctx.shadowColor = 'transparent';
    if (box.stroke) { ctx.lineWidth = box.stroke.width * scale; ctx.strokeStyle = box.stroke.color; ctx.stroke(); }
    if (box.accent) { // 左端カラーバー
      const aw = (box.accent.width || 14) * scale;
      ctx.save(); shapePath(ctx, box, r); ctx.clip();
      ctx.fillStyle = box.accent.color;
      if (box.accent.side === 'bottom') ctx.fillRect(r.x, r.y + r.h - aw, r.w, aw);
      else if (box.accent.side === 'top') ctx.fillRect(r.x, r.y, r.w, aw);
      else ctx.fillRect(r.x, r.y, aw, r.h);
      ctx.restore();
    }
    if (box.innerLine) { // 二重線
      const g = box.innerLine.gap * scale;
      ctx.lineWidth = box.innerLine.width * scale; ctx.strokeStyle = box.innerLine.color;
      shapePath(ctx, box, { x: r.x + g, y: r.y + g, w: r.w - 2 * g, h: r.h - 2 * g }); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- レイアウト計算 & 描画 ---------- */
  /**
   * render(canvas, design, options)
   * options: { text, sub, tagText, variant, width, height, plateOnly, offsetY, offsetX, scale, background }
   */
  function render(canvas, design, options) {
    const o = Object.assign({ text: design.sample || 'サンプルテロップ', sub: design.sampleSub || '', variant: 0, width: 1920, height: 1080, plateOnly: false, offsetX: 0, offsetY: 0, background: null }, options || {});
    const spec = resolve(design, o.variant);
    if (o.tagText != null && o.tagText !== '' && spec.tag) spec.tag = Object.assign({}, spec.tag, { text: String(o.tagText) }); // タグ文字の差し替え（未指定なら従来どおり）
    const W = o.width, H = o.height;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, W, H); }

    // 9:16 では自動で少し縮小。横幅に収まらない場合は自動フィット
    let scale = (o.scale || 1) * (W < H ? (spec.portraitScale || 0.8) : 1);
    const lines = String(o.text || '').split('\n');
    let size, lh, m, textW, textH;
    const measureAll = () => {
      size = spec.font.size * scale; lh = spec.lineHeight * size;
      m = measureLines(ctx, spec.font, lines, scale);
      textW = Math.max(...m.widths, 1); textH = lh * lines.length;
    };
    measureAll();
    {
      const maxW = W - 2 * Math.max(40, (spec.anchor.margin || 0) * 0.6);
      const est = textW + ((spec.box && spec.box.padX != null ? spec.box.padX : 36) * 2 + (spec.tag ? spec.tag.font.size * 3 : 0)) * scale;
      if (est > maxW && !o.noFit) { scale *= maxW / est; measureAll(); }
    }

    // sub / tag の寸法
    let subDims = null;
    if (spec.sub && o.sub) {
      const sl = String(o.sub).split('\n');
      const sm = measureLines(ctx, spec.sub.font, sl, scale);
      subDims = { lines: sl, w: Math.max(...sm.widths), h: (spec.sub.lineHeight || 1.2) * spec.sub.font.size * scale * sl.length, gap: (spec.sub.gap == null ? 10 : spec.sub.gap) * scale };
    }
    let tagDims = null;
    if (spec.tag) {
      const tm = measureLines(ctx, spec.tag.font, [spec.tag.text], scale);
      const padX = (spec.tag.padX == null ? 18 : spec.tag.padX) * scale, padY = (spec.tag.padY == null ? 8 : spec.tag.padY) * scale;
      tagDims = { w: tm.widths[0] + padX * 2, h: spec.tag.font.size * scale * 1.2 + padY * 2, padX, padY, gap: (spec.tag.gap == null ? 16 : spec.tag.gap) * scale };
    }

    // 本文ブロックの矩形
    const box = spec.box;
    const padX = box ? (box.padX == null ? 36 : box.padX) * scale : 0;
    const padY = box ? (box.padY == null ? 14 : box.padY) * scale : 0;
    let blockW = textW + padX * 2, blockH = textH + padY * 2;
    if (box && box.minWidth) blockW = Math.max(blockW, box.minWidth * scale);
    if (box && box.type === 'bar') blockW = W;
    if (tagDims && (spec.tag.position || 'left') === 'left' && !(box && box.type === 'bar')) blockW += tagDims.w + tagDims.gap;

    // 全体の高さ（sub 含む）
    const subPos = spec.sub ? (spec.sub.position || 'above') : null;
    const totalH = blockH + (subDims && (subPos === 'above' || subPos === 'below') ? subDims.h + subDims.gap : 0);

    const ax = spec.anchor.x, ay = spec.anchor.y, margin = spec.anchor.margin * scale;
    let bx = ax === 'left' ? margin : ax === 'right' ? W - margin - blockW : (W - blockW) / 2;
    let by = ay === 'top' ? margin : ay === 'middle' ? (H - totalH) / 2 : H - margin - totalH;
    bx += o.offsetX * scale; by += o.offsetY * scale;

    // sub above
    let textTop = by;
    if (subDims && subPos === 'above') textTop = by + subDims.h + subDims.gap;
    const rect = { x: bx, y: textTop, w: blockW, h: blockH };

    if (spec.deco) drawDeco(ctx, spec.deco.filter((d) => d.behind), rect, scale, W, H);
    if (box) { box._canvasW = W; drawBox(ctx, box, rect, scale); }

    // decoration lines (e.g. 上下ライン)
    if (spec.deco) drawDeco(ctx, spec.deco.filter((d) => !d.behind), rect, scale, W, H);

    // tag
    let textX0 = rect.x + padX;
    if (tagDims) {
      const t = spec.tag;
      let tx, ty;
      if ((t.position || 'left') === 'left') {
        tx = rect.x + (box && box.type === 'bar' ? margin : padX * 0.5);
        ty = rect.y + (rect.h - tagDims.h) / 2;
        textX0 = tx + tagDims.w + tagDims.gap;
      } else { // above
        tx = rect.x; ty = rect.y - tagDims.h - (t.gap == null ? 0 : t.gap * scale);
      }
      const tr = { x: tx, y: ty, w: tagDims.w, h: tagDims.h };
      if (!o.plateOnly || t.keepOnPlate) {
        drawBox(ctx, Object.assign({ type: 'rect' }, t.box || {}), tr, scale);
        drawTextBlock(ctx, { font: t.font, lines: [t.text], x: tx + tagDims.padX, y: ty + tagDims.padY, scale, fill: t.fill || { type: 'solid', color: '#fff' }, strokes: t.strokes || [], shadow: null, align: 'left', lineHeight: 1.2, bounds: tr });
      }
    }

    if (!o.plateOnly) {
      // main text
      const align = spec.align || (box && box.type === 'bar' ? 'left' : 'center');
      let tx = align === 'center' ? textX0 + (rect.x + rect.w - padX - textX0) / 2 : align === 'right' ? rect.x + rect.w - padX : textX0;
      if (box && box.type === 'bar' && !tagDims) tx = align === 'center' ? W / 2 : margin;
      const bounds = { x: tx - textW / 2, y: rect.y + padY, w: textW, h: textH };
      drawTextBlock(ctx, { font: spec.font, lines, x: tx, y: rect.y + padY, scale, fill: spec.fill, strokes: spec.strokes, shadow: spec.shadow, extrude: spec.extrude, glow: spec.glow, align, lineHeight: spec.lineHeight, bounds });

      // sub
      if (subDims) {
        const s = spec.sub;
        let sx, sy, salign = s.align || 'center';
        if (subPos === 'above') { sy = by; }
        else if (subPos === 'below') { sy = rect.y + rect.h + subDims.gap; }
        else { sy = rect.y + (rect.h - subDims.h) / 2; }
        if (subPos === 'right') { sx = rect.x + rect.w + subDims.gap; salign = 'left'; }
        else if (salign === 'left') sx = rect.x + 14 * scale + (s.indent == null ? 0 : s.indent * scale);
        else sx = rect.x + rect.w / 2;
        const sb = { x: sx, y: sy, w: subDims.w, h: subDims.h };
        if (s.box) { // sub.padX / sub.padY で余白を指定（未指定なら従来どおり 14px・0px）
          const spx = (s.padX == null ? 14 : s.padX) * scale, spy = (s.padY == null ? 0 : s.padY) * scale;
          drawBox(ctx, s.box, { x: salign === 'center' ? sx - subDims.w / 2 - spx - 2 * scale : sx - spx, y: sy - spy, w: subDims.w + spx * 2, h: subDims.h + spy * 2 }, scale);
        }
        drawTextBlock(ctx, { font: s.font, lines: subDims.lines, x: salign === 'center' ? sx : sx + (s.box ? 0 : 0), y: sy, scale, fill: s.fill || { type: 'solid', color: '#fff' }, strokes: s.strokes || [], shadow: s.shadow || null, align: salign, lineHeight: s.lineHeight || 1.2, bounds: sb });
      }
    }
    return { rect, spec };
  }

  function drawDeco(ctx, deco, r, scale, W, H) {
    ctx.save();
    for (const d of deco) {
      const c = d.color || '#fff';
      ctx.fillStyle = c; ctx.strokeStyle = c;
      const t = (d.thickness || 4) * scale;
      switch (d.type) {
        case 'radial': { // 集中線（ブロック中心から画面端へ）
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          const r0 = Math.hypot(r.w, r.h) / 2 * (d.inner == null ? 1.15 : d.inner);
          const R = Math.hypot(W, H);
          const n = d.count || 40, wdt = (d.width == null ? 0.012 : d.width);
          for (let i = 0; i < n; i++) {
            const a = (Math.PI * 2 * i) / n + ((i * 7919) % 13) * 0.004; // 少しランダム
            const len = R * (0.75 + ((i * 104729) % 10) / 40);
            ctx.beginPath();
            ctx.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a));
            ctx.lineTo(cx + len * Math.cos(a - wdt), cy + len * Math.sin(a - wdt));
            ctx.lineTo(cx + len * Math.cos(a + wdt), cy + len * Math.sin(a + wdt));
            ctx.closePath(); ctx.fill();
          }
          break;
        }
        case 'ring': { // 楕円の輪（花マル風）
          const padX = (d.padX == null ? 40 : d.padX) * scale, padY = (d.padY == null ? 10 : d.padY) * scale;
          ctx.lineWidth = t; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 + padX, r.h / 2 + padY, -0.06, 0.15, Math.PI * 2 + 0.6);
          ctx.stroke(); break;
        }
        case 'speedlines': { // 左右の効果線
          const g = (d.gap || 24) * scale, n = d.n || 3, len = (d.length || 90) * scale;
          ctx.lineWidth = t; ctx.lineCap = 'round';
          for (let i = 0; i < n; i++) {
            const y = r.y + (r.h * (i + 1)) / (n + 1), l = len * (1 - i * 0.25);
            ctx.beginPath(); ctx.moveTo(r.x - g, y); ctx.lineTo(r.x - g - l, y - l * 0.2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(r.x + r.w + g, y); ctx.lineTo(r.x + r.w + g + l, y - l * 0.2); ctx.stroke();
          }
          break;
        }
        case 'zigzag': { // ギザギザ下線（怒り・緊張）
          const amp = (d.amp || 10) * scale, step = (d.step || 22) * scale, y0 = r.y + r.h + (d.gap || 10) * scale;
          ctx.lineWidth = t; ctx.lineJoin = 'round';
          ctx.beginPath(); let up = false;
          for (let x = r.x; x <= r.x + r.w; x += step) { ctx.lineTo(x, y0 + (up ? -amp : amp)); up = !up; }
          ctx.stroke(); break;
        }
        case 'dropLines': { // 頭上の「ガーン」縦線
          const n = d.n || 5, len = (d.length || 60) * scale, gap = (d.gap || 14) * scale;
          ctx.lineWidth = t; ctx.lineCap = 'round';
          for (let i = 0; i < n; i++) { const x = r.x + (r.w * (i + 0.5)) / n; ctx.beginPath(); ctx.moveTo(x, r.y - gap); ctx.lineTo(x, r.y - gap - len * (0.6 + ((i * 3) % 3) * 0.2)); ctx.stroke(); }
          break;
        }
        case 'lineTop': ctx.fillRect(d.full ? 0 : r.x, r.y - (d.gap || 8) * scale - t, d.full ? W : r.w, t); break;
        case 'lineBottom': ctx.fillRect(d.full ? 0 : r.x, r.y + r.h + (d.gap || 8) * scale, d.full ? W : r.w, t); break;
        case 'dotsLeft': { for (let i = 0; i < (d.n || 3); i++) { ctx.beginPath(); ctx.arc(r.x - (d.gap || 24) * scale - i * (d.spacing || 22) * scale, r.y + r.h / 2, t, 0, Math.PI * 2); ctx.fill(); } break; }
        case 'triangleLeft': { const s = (d.size || 30) * scale; ctx.beginPath(); ctx.moveTo(r.x - (d.gap || 18) * scale, r.y + r.h / 2 - s / 2); ctx.lineTo(r.x - (d.gap || 18) * scale + s * 0.8, r.y + r.h / 2); ctx.lineTo(r.x - (d.gap || 18) * scale, r.y + r.h / 2 + s / 2); ctx.closePath(); ctx.fill(); break; }
        case 'bracket': { // 「」風の角括弧
          const s = (d.size || 40) * scale; ctx.lineWidth = t;
          ctx.beginPath(); ctx.moveTo(r.x - s * 0.4, r.y - s * 0.3 + s); ctx.lineTo(r.x - s * 0.4, r.y - s * 0.3); ctx.lineTo(r.x - s * 0.4 + s, r.y - s * 0.3); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(r.x + r.w + s * 0.4, r.y + r.h + s * 0.3 - s); ctx.lineTo(r.x + r.w + s * 0.4, r.y + r.h + s * 0.3); ctx.lineTo(r.x + r.w + s * 0.4 - s, r.y + r.h + s * 0.3); ctx.stroke(); break;
        }
        case 'sideBars': { const g = (d.gap || 20) * scale; ctx.fillRect(r.x - g - t, r.y, t, r.h); ctx.fillRect(r.x + r.w + g, r.y, t, r.h); break; }
        case 'sparkle': { // 小さな十字キラキラ
          const pts = d.points || [[0.08, 0.15], [0.92, 0.2], [0.85, 0.85]];
          for (const [px, py] of pts) { const x = r.x + r.w * px, y = r.y + r.h * py, s = (d.size || 18) * scale; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s); ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s); ctx.fill(); }
          break;
        }
      }
    }
    ctx.restore();
  }

  /** 内容にフィットしたトリミング用の矩形を返す（余白付き） */
  function contentBounds(canvas, pad) {
    const ctx = canvas.getContext('2d');
    const { width: W, height: H } = canvas;
    const d = ctx.getImageData(0, 0, W, H).data;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 2) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return null;
    pad = pad || 0;
    return { x: Math.max(0, minX - pad), y: Math.max(0, minY - pad), w: Math.min(W, maxX + pad) - Math.max(0, minX - pad) + 1, h: Math.min(H, maxY + pad) - Math.max(0, minY - pad) + 1 };
  }

  /** Premiere 手動再現用レシピ（エッセンシャルグラフィックスの設定値） */
  function recipe(design, variantIndex) {
    const s = resolve(design, variantIndex);
    const out = [];
    out.push(`■ ${design.name}${s.variantName ? '（' + s.variantName + '）' : ''}`);
    out.push(`フォント: ${s.font.family} / ウェイト ${s.font.weight}${s.font.italic ? ' / イタリック' : ''}${s.font.skew ? ' / 斜体 ' + s.font.skew + '°' : ''}`);
    out.push(`サイズ: ${s.font.size}px（1920×1080基準）  字間: ${Math.round((s.font.letterSpacing || 0) * 1000)}  行間: ${s.lineHeight}`);
    if (s.fill.type === 'gradient') out.push(`塗り: グラデーション ${s.fill.stops.map((x) => x[1]).join(' → ')} (角度 ${s.fill.angle == null ? 90 : s.fill.angle}°)`);
    else out.push(`塗り: ${s.fill.color}`);
    const st = (s.strokes || []).slice().sort((a, b) => a.width - b.width);
    st.forEach((k, i) => out.push(`ストローク${i + 1}（内→外）: ${k.color || 'グラデ'} 幅 ${k.width}px`));
    if (s.shadow) out.push(`シャドウ: ${s.shadow.color} 距離 X${s.shadow.dx || 0}/Y${s.shadow.dy || 0} ぼかし ${s.shadow.blur || 0}`);
    if (s.extrude) out.push(`立体（押し出し）: ${s.extrude.color} 深さ ${s.extrude.depth}`);
    if (s.glow) out.push(`グロー: ${s.glow.color} ぼかし ${s.glow.blur}`);
    if (s.box && s.box.type !== 'none') out.push(`背景シェイプ: ${s.box.type} 塗り ${s.box.fill ? (s.box.fill.color || 'グラデ') : 'なし'} 余白 X${s.box.padX == null ? 36 : s.box.padX}/Y${s.box.padY == null ? 14 : s.box.padY}${s.box.accent ? ' アクセント ' + s.box.accent.color : ''}`);
    if (s.sub) out.push(`サブテキスト: ${s.sub.font.family} ${s.sub.font.size}px ${s.sub.fill ? s.sub.fill.color || '' : ''}`);
    if (s.tag) out.push(`タグ: 「${s.tag.text}」 ${s.tag.font.family} ${s.tag.font.size}px`);
    return out.join('\n');
  }

  const API = { render, resolve, ensureFonts, contentBounds, recipe, fontString, deepMerge };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.TelopRenderer = API;
})(typeof window !== 'undefined' ? window : globalThis);
