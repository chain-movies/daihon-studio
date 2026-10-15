#!/usr/bin/env node
/* 編集プラン（plan.json）→ Chain Cut プロジェクト（project.json ＋ 素材ごと .chaincut.zip）
 *
 *   node factory/chain-cut/build.mjs plan.json [--out work/out]
 *
 * プランの書き方は factory/chain-cut/README.md。時刻は「src」（素材の秒）か「at」（完成動画の秒）で書ける。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { args, ROOT, probe, mimeOf, detectSilence, keepsFromSilence, zipDir, safeName, uid, fmt } from './lib.mjs';

const require = createRequire(import.meta.url);
const { DESIGNS } = require(path.join(ROOT, 'telop', 'designs.js'));
const SE_INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'chain-cut', 'se', 'index.json'), 'utf8'));

const ASPECTS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };
const LOOKS = {
  cinema: { contrast: 115, saturate: 85, brightness: 95, vignette: 45 },
  vivid: { contrast: 110, saturate: 140, brightness: 103 },
  retro: { contrast: 90, saturate: 80, brightness: 105, sepia: 35, vignette: 35, hue: -8 },
  mono: { grayscale: 100, contrast: 120, vignette: 25 },
  bright: { brightness: 110, contrast: 105, saturate: 110 },
};

export function build(planPath, outOverride) {
  const planDir = path.dirname(path.resolve(planPath));
  const rel = (p) => (path.isAbsolute(p) ? p : fs.existsSync(path.resolve(planDir, p)) ? path.resolve(planDir, p) : path.resolve(ROOT, p));
  let plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const warnings = [];
  const warn = (m) => { if (warnings.includes(m)) return; warnings.push(m); console.warn('⚠ ' + m); };

  // ---------- スタイル（トレースした演出の型）を下敷きにする ----------
  let style = {};
  if (plan.style) {
    style = JSON.parse(fs.readFileSync(rel(plan.style), 'utf8'));
    console.log(`スタイル: ${style.name || plan.style}`);
  }
  const S = (k, d) => (plan[k] !== undefined ? plan[k] : style[k] !== undefined ? style[k] : d);
  const telopStyle = Object.assign({}, style.telop || {}, plan.telopStyle || {});
  const cutStyle = Object.assign({}, style.cut || {}, plan.cut || {});

  const aspect = S('aspect', '16:9');
  const [W, H] = ASPECTS[aspect] || ASPECTS['16:9'];
  const fps = S('fps', 30);
  const snap = (t) => Math.round(t * fps) / fps;
  const designs = [].concat(style.designs || [], plan.designs || []);
  const designIds = new Set(DESIGNS.map((d) => d.id).concat(designs.map((d) => d.id)));

  // ---------- 素材 ----------
  const outDir = path.resolve(outOverride || (plan.out ? rel(plan.out) : path.join(planDir, 'out')));
  const stage = path.join(outDir, 'project');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'media'), { recursive: true });
  const P = { version: 1, id: uid('p'), name: plan.name || '自動編集', aspect, width: W, height: H, fps, tracks: [], clips: [], media: [], designs };
  const mediaByKey = {};
  const addMedia = (key, file, label) => {
    if (mediaByKey[key]) return mediaByKey[key];
    if (!fs.existsSync(file)) throw new Error(`素材が見つかりません: ${file}`);
    const info = probe(file);
    if (!info.type) throw new Error(`扱えない素材です: ${file}`);
    const id = 'm_' + key.replace(/[^\w-]/g, '_');
    const name = label || path.basename(file);
    const meta = { id, name, size: info.size, mime: mimeOf(file), type: info.type, duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio };
    const dest = path.join(stage, 'media', `${id}__${safeName(name)}`);
    try { fs.linkSync(file, dest); } catch (e) { fs.copyFileSync(file, dest); }
    P.media.push(meta);
    mediaByKey[key] = Object.assign({ file, info }, meta);
    return mediaByKey[key];
  };
  for (const [k, f] of Object.entries(plan.media || {})) addMedia(k, rel(f));
  const seMedia = (file) => {
    const s = SE_INDEX.find((x) => x.id === file || x.file === file);
    if (!s) { warn(`効果音 ${file} はありません（${SE_INDEX.map((x) => x.id).join(', ')}）`); return null; }
    return addMedia('se_' + s.id, path.join(ROOT, 'apps', 'chain-cut', 'se', s.file), 'SE_' + s.file);
  };

  // ---------- トラック ----------
  const track = (id, kind) => { if (!P.tracks.find((t) => t.id === id)) P.tracks.push({ id, kind, muted: false, hidden: false }); return id; };
  const ORDER = { telop: 0, video: 1, audio: 2 };
  const sortTracks = () => P.tracks.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (a.kind === 'audio' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id)));
  ['T1', 'V2', 'V1', 'A1', 'A2'].forEach((id) => track(id, id[0] === 'T' ? 'telop' : id[0] === 'V' ? 'video' : 'audio'));

  const base = (type, tr, start, dur) => ({ id: uid('c'), type, track: tr, start: snap(Math.max(0, start)), dur: Math.max(1 / fps, snap(dur)), in: 0, volume: 1, fadeIn: 0, fadeOut: 0, x: 0, y: 0, scale: 100, opacity: 100, fit: 'contain' });
  const clipEnd = (c) => c.start + c.dur;

  // ---------- メインの並び（カット） ----------
  const segments = []; // {key, srcIn, srcOut, outStart}
  let pos = 0;
  const seq = plan.sequence || (plan.media && plan.media.main ? [{ media: 'main' }] : []);
  for (const item of seq) {
    const m = mediaByKey[item.media];
    if (!m) throw new Error(`sequence の media "${item.media}" が media にありません`);
    const dur = m.type === 'image' ? (item.dur || 3) : m.duration;
    let keeps = item.keep;
    const sc = item.silenceCut !== undefined ? item.silenceCut : cutStyle.silenceCut;
    if (!keeps && sc && m.hasAudio) {
      const o = Object.assign({ threshold: -38, minSilence: 0.45, pad: 0.08 }, typeof sc === 'object' ? sc : {});
      keeps = keepsFromSilence(detectSilence(m.file, o.threshold, o.minSilence), dur, o.pad);
      const kept = keeps.reduce((s, [a, b]) => s + b - a, 0);
      console.log(`無音カット ${item.media}: ${keeps.length} 区間を残す（${fmt(dur)} → ${fmt(kept)}）`);
    }
    if (!keeps) keeps = [[item.in || 0, item.out || dur]];
    keeps.forEach(([a, b], i) => {
      a = snap(Math.max(0, a)); b = snap(Math.min(dur, b));
      if (b - a < 1 / fps) return;
      const c = base(m.type, item.track || 'V1', pos, b - a);
      Object.assign(c, { mediaId: m.id, in: m.type === 'image' ? 0 : a, fit: item.fit || S('fit', aspect === '9:16' && m.width > m.height ? 'cover' : 'contain') });
      if (item.volumeDb != null) c.volume = Math.pow(10, item.volumeDb / 20);
      const z = item.jumpCutZoom !== undefined ? item.jumpCutZoom : cutStyle.jumpCutZoom;
      if (z && i % 2 === 1) c.scale = Math.round(100 * z);
      const ct = item.cutTransition || cutStyle.transition;
      if (ct && ct.type && (segments.length || i)) c.trIn = { type: ct.type, dur: ct.dur || 0.15 };
      if (item.clip) Object.assign(c, item.clip);
      P.clips.push(c);
      segments.push({ key: item.media, srcIn: a, srcOut: b, outStart: c.start, clip: c });
      pos = clipEnd(c);
    });
  }
  const total = () => P.clips.reduce((d, c) => Math.max(d, clipEnd(c)), 0);
  const mainDur = pos;

  /** 素材の秒 → 完成動画の秒（カットされた所なら次の区間の頭） */
  const srcToOut = (t, key) => {
    key = key || (seq[0] && seq[0].media);
    const segs = segments.filter((s) => s.key === key);
    for (const s of segs) {
      if (t < s.srcIn) return s.outStart;
      if (t <= s.srcOut) return s.outStart + (t - s.srcIn);
    }
    return segs.length ? segs[segs.length - 1].outStart + (segs[segs.length - 1].srcOut - segs[segs.length - 1].srcIn) : t;
  };
  const isCut = (t, key) => { const segs = segments.filter((s) => s.key === (key || (seq[0] && seq[0].media))); return segs.length && !segs.some((s) => t >= s.srcIn - 0.02 && t <= s.srcOut + 0.02); };
  const when = (o) => (o.at != null ? o.at : o.src != null ? srcToOut(o.src, o.srcMedia) : null);
  const span = (o, defDur) => {
    const a = when(o);
    if (a == null) return null;
    let b;
    if (o.end != null) b = o.end; else if (o.srcEnd != null) b = srcToOut(o.srcEnd, o.srcMedia); else b = a + (o.dur || defDur);
    return [snap(a), snap(Math.max(a + 0.2, b))];
  };

  // ---------- テロップ ----------
  const telops = [].concat(plan.telops || []);
  const tft = plan.telopsFromTranscript;
  if (tft) {
    const words = JSON.parse(fs.readFileSync(rel(tft.file || tft), 'utf8'));
    const auto = phrasesFromTranscript(words, Object.assign({ maxChars: telopStyle.maxChars || 14 }, typeof tft === 'object' ? tft : {}));
    let dropped = 0;
    auto.forEach((ph, i) => {
      if (isCut((ph.s + ph.e) / 2, tft.media)) { dropped++; return; }
      const next = auto[i + 1];
      // 少し余韻を残すが、次のテロップとは重ねない
      const end = Math.min(ph.e + 0.3, next ? next.s : Infinity);
      telops.push({ text: ph.text, src: ph.s, srcEnd: Math.max(end, ph.s + 0.6), srcMedia: tft.media, auto: true });
    });
    console.log(`文字起こしからテロップ ${auto.length - dropped} 件${dropped ? `（カット部分の ${dropped} 件は除外）` : ''}`);
  }
  const telopBusy = {}; // トラック → [[開始, 終了], ...]
  const timed = [];
  for (const t of telops) { const sp = span(t, 2.5); if (!sp) warn(`時刻のないテロップ: ${t.text}`); else timed.push([t, sp]); }
  // 時刻順、同じ時刻なら通常 → 強調（強調が上のトラックに来る）
  timed.sort((a, b) => a[1][0] - b[1][0] || (a[0].emphasis ? 1 : 0) - (b[0].emphasis ? 1 : 0));
  for (const [t, sp] of timed) {
    let designId = t.design || (t.emphasis && telopStyle.emphasisDesign) || telopStyle.design || DESIGNS[0].id;
    if (!designIds.has(designId)) { warn(`デザイン ${designId} がないので既定に置き換え`); designId = telopStyle.design && designIds.has(telopStyle.design) ? telopStyle.design : DESIGNS[0].id; }
    // 重なるときは T2, T3… へ
    let n = t.track ? +String(t.track).replace(/\D/g, '') : 1;
    const overlaps = (id) => (telopBusy[id] || []).some(([a, b]) => a < sp[1] - 1e-3 && b > sp[0] + 1e-3);
    if (!t.track) while (overlaps('T' + n)) n++;
    const tr = track('T' + n, 'telop');
    const c = base('telop', tr, sp[0], sp[1] - sp[0]);
    Object.assign(c, {
      designId, variant: t.variant != null ? t.variant : (t.emphasis && telopStyle.emphasisVariant != null ? telopStyle.emphasisVariant : telopStyle.variant || 0),
      text: t.text, sub: t.sub || '', anim: t.anim || (t.emphasis && telopStyle.emphasisAnim) || telopStyle.anim || 'none',
      fadeIn: t.fadeIn != null ? t.fadeIn : telopStyle.fadeIn != null ? telopStyle.fadeIn : 0.08,
      fadeOut: t.fadeOut != null ? t.fadeOut : telopStyle.fadeOut != null ? telopStyle.fadeOut : 0.08,
    });
    for (const k of ['x', 'y', 'scale', 'opacity', 'rotation', 'kf', 'fx', 'trIn', 'trOut']) if (t[k] != null) c[k] = t[k];
    if (telopStyle.y != null && t.y == null) c.y = telopStyle.y;
    if (telopStyle.scale != null && t.scale == null) c.scale = telopStyle.scale;
    P.clips.push(c);
    (telopBusy[tr] = telopBusy[tr] || []).push([c.start, clipEnd(c)]);
    const se = t.se !== undefined ? t.se : (t.emphasis ? telopStyle.emphasisSe : t.auto ? telopStyle.autoSe : telopStyle.se);
    if (se) (plan.se = plan.se || []).push({ file: se, at: c.start, volume: telopStyle.seVolume || 0.6 });
  }

  // ---------- 演出（メイン映像への効果） ----------
  const splitAt = (t) => {
    t = snap(t);
    for (const c of P.clips.filter((x) => x.track === 'V1' && t > x.start + 1e-3 && t < clipEnd(x) - 1e-3)) {
      const r = JSON.parse(JSON.stringify(c)); r.id = uid('c');
      const left = t - c.start;
      r.start = t; r.dur = snap(c.dur - left); r.in = (c.in || 0) + left; delete r.trIn; c.dur = snap(left); delete c.trOut;
      if (c.kf) { delete r.kf; }
      P.clips.push(r);
    }
  };
  for (const ef of plan.effects || []) {
    const sp = span(ef, ef.type === 'punch' ? 1.5 : 2);
    if (!sp) { warn(`時刻のない演出: ${ef.type}`); continue; }
    splitAt(sp[0]); splitAt(sp[1]);
    const inside = P.clips.filter((c) => c.track === (ef.track || 'V1') && c.start >= sp[0] - 1e-3 && clipEnd(c) <= sp[1] + 1e-3);
    if (!inside.length) { warn(`演出 ${ef.type}（${fmt(sp[0])}）の位置に映像がありません`); continue; }
    for (const c of inside) {
      const s0 = c.scale || 100, a = ef.amount;
      if (ef.type === 'punch') c.scale = Math.round(s0 * (a || 1.25));
      else if (ef.type === 'zoomIn') c.kf = Object.assign(c.kf || {}, { scale: [[0, s0, 'easeInOut'], [c.dur, s0 * (a || 1.15), 'easeInOut']] });
      else if (ef.type === 'zoomOut') c.kf = Object.assign(c.kf || {}, { scale: [[0, s0 * (a || 1.15), 'easeInOut'], [c.dur, s0, 'easeInOut']] });
      else if (ef.type === 'kenburns') c.kf = Object.assign(c.kf || {}, { scale: [[0, s0 * 1.08, 'linear'], [c.dur, s0 * 1.2, 'linear']], x: [[0, -40, 'linear'], [c.dur, 40, 'linear']] });
      else if (ef.type === 'shake') c.fx = Object.assign(c.fx || {}, { shake: a || 14 });
      else if (ef.type === 'look') c.fx = Object.assign(c.fx || {}, LOOKS[ef.look] || ef.fx || {});
      else if (ef.type === 'mono') c.fx = Object.assign(c.fx || {}, LOOKS.mono);
      else if (ef.type === 'blur') c.fx = Object.assign(c.fx || {}, { blur: a || 12 });
      else if (['flash', 'dip', 'whip', 'zoom', 'slideL', 'slideUp', 'spin'].includes(ef.type)) { if (c === inside[0]) c.trIn = { type: ef.type, dur: ef.transDur || 0.2 }; }
      else warn(`未対応の演出: ${ef.type}`);
    }
    if (ef.se) (plan.se = plan.se || []).push({ file: ef.se, at: sp[0], volume: ef.seVolume || 0.7 });
  }
  // スタイルの色味を全体に
  const look = plan.look !== undefined ? plan.look : style.look;
  if (look) for (const c of P.clips.filter((x) => x.track === 'V1')) c.fx = Object.assign({}, typeof look === 'string' ? LOOKS[look] : look, c.fx || {});

  // ---------- 重ねる素材（ロゴ・画像・ワイプ） ----------
  for (const o of plan.overlays || []) {
    const m = mediaByKey[o.media]; if (!m) { warn(`overlay の media "${o.media}" がありません`); continue; }
    const sp = span(o, m.type === 'image' ? 3 : m.duration);
    const tr = track(o.track || 'V2', 'video');
    const c = base(m.type, tr, sp[0], sp[1] - sp[0]);
    c.mediaId = m.id; c.in = o.in || 0;
    for (const k of ['x', 'y', 'scale', 'opacity', 'rotation', 'kf', 'fx', 'trIn', 'trOut', 'fit', 'fadeIn', 'fadeOut', 'volume']) if (o[k] != null) c[k] = o[k];
    P.clips.push(c);
  }

  // ---------- 効果音 ----------
  const seEnds = {};
  for (const s of plan.se || []) {
    const t = when(s); if (t == null) continue;
    const m = seMedia(s.file); if (!m) continue;
    let n = 2; while ((seEnds['A' + n] || 0) > t + 1e-3) n++;
    const tr = track('A' + n, 'audio');
    const c = base('audio', tr, t, m.duration);
    c.mediaId = m.id; c.volume = s.volume != null ? s.volume : 0.7;
    P.clips.push(c); seEnds[tr] = clipEnd(c);
  }

  // ---------- BGM ----------
  const bgm = plan.bgm;
  if (bgm && bgm.media) {
    const m = mediaByKey[bgm.media];
    if (!m) warn(`bgm の media "${bgm.media}" がありません`);
    else {
      const vol = Math.pow(10, (bgm.volumeDb != null ? bgm.volumeDb : (style.bgm && style.bgm.volumeDb) || -20) / 20);
      const end = bgm.end != null ? bgm.end : Math.max(mainDur, total());
      let t = bgm.at || 0;
      const srcIn = bgm.in || 0;
      while (t < end - 0.05) {
        const d = Math.min(m.duration - srcIn, end - t);
        const c = base('audio', 'A1', t, d);
        Object.assign(c, { mediaId: m.id, in: srcIn, volume: vol });
        P.clips.push(c);
        t += d;
        if (!bgm.loop && bgm.loop !== undefined) break;
      }
      const bc = P.clips.filter((c) => c.track === 'A1' && c.mediaId === m.id).sort((a, b) => a.start - b.start);
      if (bc.length) { bc[0].fadeIn = bgm.fadeIn != null ? bgm.fadeIn : 1; bc[bc.length - 1].fadeOut = bgm.fadeOut != null ? bgm.fadeOut : 2; }
    }
  }

  // ---------- 仕上げ ----------
  sortTracks();
  P.clips.sort((a, b) => a.start - b.start);
  for (const d of designs) if (!d.pack) d.pack = 'project';
  if (plan.inOut) { P.inPoint = plan.inOut[0]; P.outPoint = plan.inOut[1]; }
  fs.writeFileSync(path.join(stage, 'project.json'), JSON.stringify(Object.assign({ app: 'chain-cut', savedAt: new Date().toISOString(), generator: 'factory/chain-cut/build.mjs' }, P), null, 1));
  fs.writeFileSync(path.join(stage, 'はじめにお読みください.txt'), 'このファイルは動画編集ソフト「Chain Cut」のプロジェクトです。\r\nChain Cut の「ファイル → プロジェクトを開く」でこの .zip を選んでください（解凍は不要です）。\r\n');
  const zipPath = path.join(outDir, safeName(P.name) + '.chaincut.zip');
  zipDir(stage, zipPath);

  // 人が読む編集メモ
  const lines = [`# ${P.name}`, '', `- 画面: ${aspect}（${W}×${H}）${fps}fps`, `- 尺: ${fmt(total())}`, `- カット: ${segments.length} 区間`, ''];
  lines.push('## テロップ', '', '| 開始 | 長さ | 文字 | デザイン | アニメ |', '|---|---|---|---|---|');
  for (const c of P.clips.filter((x) => x.type === 'telop')) lines.push(`| ${fmt(c.start)} | ${c.dur.toFixed(1)}s | ${c.text.replace(/\n/g, ' / ')} | ${c.designId} | ${c.anim} |`);
  lines.push('', '## 効果音・演出', '');
  for (const c of P.clips.filter((x) => x.type === 'audio' && x.mediaId.startsWith('m_se_'))) lines.push(`- ${fmt(c.start)} ${c.mediaId.replace('m_se_', '')}`);
  for (const c of P.clips.filter((x) => x.track === 'V1' && (x.kf || x.fx || x.trIn || (x.scale && x.scale !== 100)))) lines.push(`- ${fmt(c.start)}〜${fmt(clipEnd(c))} ${[x(c.scale !== 100 && `拡大${c.scale}%`), x(c.kf && 'キーフレーム'), x(c.fx && 'エフェクト'), x(c.trIn && `入り:${c.trIn.type}`)].filter(Boolean).join('・')}`);
  if (warnings.length) lines.push('', '## 注意', '', ...warnings.map((w) => '- ' + w));
  fs.writeFileSync(path.join(outDir, 'edit-summary.md'), lines.join('\n') + '\n');
  console.log(`✔ ${zipPath}（${fmt(total())}・クリップ ${P.clips.length}）`);
  return { zipPath, stage, project: P, warnings, outDir };
  function x(v) { return v || null; }
}

/** 文字起こし → テロップ用のフレーズ（素材の秒） */
export function phrasesFromTranscript(tr, o) {
  const max = o.maxChars || 14, gap = o.gap != null ? o.gap : 0.35;
  const ex = (o.exclude || []).map((r) => new RegExp(r));
  const out = [];
  for (const seg of tr.segments || []) {
    const words = seg.words && seg.words.length ? seg.words : [{ start: seg.start, end: seg.end, word: seg.text }];
    let cur = null;
    const flush = () => {
      if (!cur) return;
      let text = cur.text.replace(/\s+/g, ' ').trim().replace(/^[、。,.\s]+|[、。,.\s]+$/g, '');
      if (/[ぁ-んァ-ン一-龥]/.test(text)) text = text.replace(/ /g, '');
      if (text && !ex.some((r) => r.test(text))) out.push({ s: cur.s, e: cur.e, text });
      cur = null;
    };
    for (const w of words) {
      const t = w.word;
      if (cur && (w.start - cur.e > gap || (cur.text + t).replace(/\s/g, '').length > max)) flush();
      if (!cur) cur = { s: w.start, e: w.end, text: '' };
      cur.text += t; cur.e = w.end;
      if (/[。！？!?]$/.test(t.trim()) || (/[、,]$/.test(t.trim()) && cur.text.length >= max * 0.6)) flush();
    }
    flush();
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pos, opt } = args();
  if (!pos[0]) { console.error('使い方: node factory/chain-cut/build.mjs plan.json [--out dir]'); process.exit(1); }
  try { build(pos[0], opt.out); } catch (e) { console.error('✖ ' + e.message); process.exit(1); }
}
