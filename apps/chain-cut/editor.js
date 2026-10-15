/* =====================================================================
   Chain Cut — ブラウザ動画編集ソフト
   タイムライン編集 / テロップ（telop/renderer.js 共通） / BGM / 無音カット /
   SRT 読込 / WebCodecs による MP4 書き出し / IndexedDB 自動保存
   ===================================================================== */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = (p) => (p || 'c') + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const EPS = 1e-6;
  const MIN_DUR = 0.1;

  const D = window.TelopDesigns, R = window.TelopRenderer;
  const DESIGNS = (D && D.DESIGNS) || [];
  const PACKS = (D && D.PACKS) || {};
  const designById = new Map(DESIGNS.map((d) => [d.id, d]));

  /* =================================================================
     状態
     ================================================================= */
  const ASPECTS = {
    '16:9': { w: 1920, h: 1080, label: '横 16:9', sub: 'YouTube・テレビ' },
    '9:16': { w: 1080, h: 1920, label: '縦 9:16', sub: 'ショート・リール' },
    '1:1': { w: 1080, h: 1080, label: '正方形 1:1', sub: 'フィード投稿' },
  };

  function defaultTracks() {
    return [
      { id: 'T1', kind: 'telop', muted: false, hidden: false },
      { id: 'V2', kind: 'video', muted: false, hidden: false },
      { id: 'V1', kind: 'video', muted: false, hidden: false },
      { id: 'A1', kind: 'audio', muted: false, hidden: false },
      { id: 'A2', kind: 'audio', muted: false, hidden: false },
    ];
  }
  function newProject(aspect, fps) {
    const a = ASPECTS[aspect] || ASPECTS['16:9'];
    return { version: 1, id: uid('p'), name: '無題のプロジェクト', aspect: aspect || '16:9', width: a.w, height: a.h, fps: fps || 30, tracks: defaultTracks(), clips: [], media: [] };
  }

  let P = newProject('16:9', 30);           // プロジェクト（保存対象）
  const media = new Map();                    // id → ランタイム情報 {meta, blob, url, thumb, peaks, img, buffer, el}
  const st = {
    time: 0, playing: false, rate: 1, loop: false,
    sel: new Set(), tool: 'select', snap: true, safe: false,
    pps: 60, ltab: 'bin',
    libPack: '', libQ: '', libDesign: null, libVariant: 0,
    clipboard: null,
  };

  /* =================================================================
     Undo / Redo
     ================================================================= */
  const undoStack = [], redoStack = [];
  let lastCoalesce = { key: null, t: 0 };
  function snapshot() { return JSON.stringify({ tracks: P.tracks, clips: P.clips, media: P.media, name: P.name }); }
  function pushUndo(coalesceKey) {
    const now = performance.now();
    if (coalesceKey && lastCoalesce.key === coalesceKey && now - lastCoalesce.t < 900) { lastCoalesce.t = now; return; }
    lastCoalesce = { key: coalesceKey || null, t: now };
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(s) {
    const o = JSON.parse(s);
    P.tracks = o.tracks; P.clips = o.clips; P.media = o.media; P.name = o.name;
    for (const id of Array.from(st.sel)) if (!clipById(id)) st.sel.delete(id);
    changed({ structure: true });
  }
  function undo() { if (!undoStack.length) return toast('これ以上取り消せません'); redoStack.push(snapshot()); restore(undoStack.pop()); lastCoalesce.key = null; }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); lastCoalesce.key = null; }

  /* =================================================================
     ユーティリティ
     ================================================================= */
  function fps() { return P.fps || 30; }
  function snapFrame(t) { const f = fps(); return Math.round(t * f) / f; }
  function tc(t) {
    const f = fps(); t = Math.max(0, t);
    let fr = Math.round(t * f);
    const ff = fr % f; fr = (fr - ff) / f;
    const s = fr % 60, m = Math.floor(fr / 60) % 60, h = Math.floor(fr / 3600);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}:${p(ff)}`;
  }
  function shortTime(t) {
    if (!isFinite(t)) return '静止画';
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function clipById(id) { return P.clips.find((c) => c.id === id); }
  function trackById(id) { return P.tracks.find((t) => t.id === id); }
  function clipEnd(c) { return c.start + c.dur; }
  function duration() { let d = 0; for (const c of P.clips) d = Math.max(d, clipEnd(c)); return d; }
  function kindForType(type) { return type === 'audio' ? 'audio' : type === 'telop' ? 'telop' : 'video'; }
  function mediaMeta(id) { return P.media.find((m) => m.id === id); }
  function fadeFactor(c, t) {
    let a = 1;
    const local = t - c.start, rem = clipEnd(c) - t;
    if (c.fadeIn > 0 && local < c.fadeIn) a *= clamp(local / c.fadeIn, 0, 1);
    if (c.fadeOut > 0 && rem < c.fadeOut) a *= clamp(rem / c.fadeOut, 0, 1);
    return a;
  }
  function isActive(c, t) { return t >= c.start - EPS && t < clipEnd(c) - EPS; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  let toastTimer = null;
  function toast(msg, err) {
    let el = $('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.toggle('err', !!err);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), err ? 5000 : 2600);
  }

  /* =================================================================
     IndexedDB（素材と自動保存）
     ================================================================= */
  const DB_NAME = 'chain-cut', DB_VER = 1;
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no idb'));
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbGet(store, key) { const d = await db(); return reqP(d.transaction(store).objectStore(store).get(key)); }
  async function idbPut(store, val, key) { const d = await db(); return reqP(d.transaction(store, 'readwrite').objectStore(store).put(val, key)); }
  async function idbDel(store, key) { const d = await db(); return reqP(d.transaction(store, 'readwrite').objectStore(store).delete(key)); }

  let saveTimer = null, saving = false;
  function scheduleSave() {
    const s = $('#savestate'); s.textContent = '未保存の変更'; s.classList.add('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 700);
  }
  async function autosave() {
    if (saving) { scheduleSave(); return; }
    saving = true;
    try {
      await idbPut('kv', JSON.parse(JSON.stringify(P)), 'project');
      const d = new Date();
      const s = $('#savestate'); s.textContent = `自動保存 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; s.classList.remove('dirty');
    } catch (e) {
      $('#savestate').textContent = '自動保存できません';
    } finally { saving = false; }
  }

  /* =================================================================
     素材の読み込み
     ================================================================= */
  let audioCtx = null, masterGain = null, analyserL = null, analyserR = null;
  function actx() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC({ sampleRate: 48000 });
    masterGain = audioCtx.createGain();
    const split = audioCtx.createChannelSplitter(2);
    analyserL = audioCtx.createAnalyser(); analyserR = audioCtx.createAnalyser();
    analyserL.fftSize = analyserR.fftSize = 1024;
    masterGain.connect(audioCtx.destination);
    masterGain.connect(split); split.connect(analyserL, 0); split.connect(analyserR, 1);
    return audioCtx;
  }

  function detectType(file) {
    const t = file.type || '';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    if (t.startsWith('image/')) return 'image';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(ext)) return 'audio';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
    return null;
  }

  function computePeaks(buf, perSec) {
    perSec = perSec || 50;
    const n = Math.ceil(buf.duration * perSec);
    const out = new Array(n).fill(0);
    const chs = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chs.push(buf.getChannelData(c));
    const step = buf.sampleRate / perSec;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * step), b = Math.min(buf.length, Math.floor((i + 1) * step));
      let mx = 0;
      for (const ch of chs) for (let j = a; j < b; j += 4) { const v = Math.abs(ch[j]); if (v > mx) mx = v; }
      out[i] = Math.round(Math.min(1, mx) * 255);
    }
    return out;
  }

  async function decodeAudio(blob) {
    const ab = await blob.arrayBuffer();
    const ctx = actx();
    return await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(ab, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }

  function probeVideo(url) {
    return new Promise((res, rej) => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
      const fail = () => rej(new Error('この動画形式はブラウザで再生できません'));
      v.onerror = fail;
      v.onloadedmetadata = () => {
        const dur = v.duration, w = v.videoWidth, h = v.videoHeight;
        const at = Math.min(1, (isFinite(dur) ? dur : 2) / 3);
        v.onseeked = () => {
          const c = document.createElement('canvas'); c.width = 240; c.height = Math.round(240 * (h / w || 9 / 16));
          try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (e) { /* ignore */ }
          let thumb = '';
          try { thumb = c.toDataURL('image/jpeg', 0.7); } catch (e) { /* ignore */ }
          v.removeAttribute('src'); v.load();
          res({ duration: dur, width: w, height: h, thumb });
        };
        v.currentTime = at;
      };
      setTimeout(fail, 20000);
    });
  }
  function loadImage(url) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('画像を読み込めません')); i.src = url; });
  }
  function imageThumb(img) {
    const c = document.createElement('canvas'); const s = 240 / Math.max(img.naturalWidth, 1);
    c.width = 240; c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  }

  async function importFiles(files) {
    const list = Array.from(files || []);
    const srts = list.filter((f) => /\.(srt|vtt)$/i.test(f.name));
    for (const f of srts) await importSrtFile(f);
    const added = [];
    for (const file of list) {
      if (srts.includes(file)) continue;
      const type = detectType(file);
      if (!type) { toast(`${file.name}：対応していないファイルです`, true); continue; }
      // 未リンク素材の再リンク（名前とサイズが一致）
      const un = P.media.find((m) => !media.has(m.id) && m.name === file.name && m.size === file.size);
      const id = un ? un.id : uid('m');
      const meta = un || { id, name: file.name, size: file.size, mime: file.type || '', type, duration: 0, width: 0, height: 0, hasAudio: false };
      if (!un) { P.media.push(meta); }
      const rt = { meta, blob: file, url: URL.createObjectURL(file), busy: true };
      media.set(id, rt);
      renderBin();
      try {
        await analyzeMedia(rt);
        await idbPut('media', { id, blob: file, thumb: rt.thumb, peaks: rt.peaks || null }).catch(() => {});
        added.push(meta);
      } catch (e) {
        console.error(e);
        toast(`${file.name}：${e.message || '読み込みに失敗しました'}`, true);
        media.delete(id);
        if (!un) P.media = P.media.filter((m) => m.id !== id);
      }
      rt.busy = false;
      renderBin();
    }
    if (added.length) {
      pushUndo();
      changed({ structure: true });
      toast(`${added.length} 件の素材を読み込みました。ダブルクリックかドラッグでタイムラインへ`);
    }
    return added;
  }

  async function analyzeMedia(rt) {
    const m = rt.meta;
    if (m.type === 'video') {
      const info = await probeVideo(rt.url);
      Object.assign(m, { duration: info.duration, width: info.width, height: info.height });
      rt.thumb = info.thumb;
      try {
        const buf = await decodeAudio(rt.blob);
        rt.buffer = buf; m.hasAudio = true; rt.peaks = computePeaks(buf);
      } catch (e) { m.hasAudio = false; rt.peaks = null; }
    } else if (m.type === 'audio') {
      const buf = await decodeAudio(rt.blob);
      rt.buffer = buf; m.duration = buf.duration; m.hasAudio = true; rt.peaks = computePeaks(buf);
    } else if (m.type === 'image') {
      const img = await loadImage(rt.url);
      rt.img = img; m.duration = Infinity; m.width = img.naturalWidth; m.height = img.naturalHeight;
      rt.thumb = imageThumb(img);
    }
  }

  async function getBuffer(id) {
    const rt = media.get(id);
    if (!rt || !rt.meta.hasAudio) return null;
    if (rt.buffer) return rt.buffer;
    if (!rt._decoding) rt._decoding = decodeAudio(rt.blob).then((b) => (rt.buffer = b)).catch(() => null);
    return rt._decoding;
  }

  async function restoreMedia() {
    for (const m of P.media) {
      try {
        const rec = await idbGet('media', m.id);
        if (!rec || !rec.blob) continue;
        const rt = { meta: m, blob: rec.blob, url: URL.createObjectURL(rec.blob), thumb: rec.thumb, peaks: rec.peaks };
        if (m.type === 'image') { try { rt.img = await loadImage(rt.url); } catch (e) { continue; } }
        media.set(m.id, rt);
        if ((!rt.thumb && m.type !== 'audio') || (!rt.peaks && m.type !== 'image')) {
          // パッケージから復元した素材：サムネイルと波形を作り直す
          rt.busy = true;
          analyzeMedia(rt).then(() => idbPut('media', { id: m.id, blob: rt.blob, thumb: rt.thumb, peaks: rt.peaks || null })).catch(() => {})
            .finally(() => { rt.busy = false; renderBin(); renderTimeline(); });
        }
      } catch (e) { /* ignore */ }
    }
  }

  async function removeMedia(id) {
    const used = P.clips.filter((c) => c.mediaId === id).length;
    if (used && !confirm(`この素材はタイムラインで ${used} 個のクリップに使われています。クリップごと削除しますか？`)) return;
    pushUndo();
    P.clips = P.clips.filter((c) => c.mediaId !== id);
    P.media = P.media.filter((m) => m.id !== id);
    const rt = media.get(id); if (rt && rt.url) URL.revokeObjectURL(rt.url);
    media.delete(id);
    idbDel('media', id).catch(() => {});
    changed({ structure: true });
  }

  /* =================================================================
     クリップ作成
     ================================================================= */
  function baseClip(type, track, start, dur) {
    return { id: uid('c'), type, track, start: snapFrame(Math.max(0, start)), dur: Math.max(MIN_DUR, dur), in: 0, volume: 1, fadeIn: 0, fadeOut: 0, x: 0, y: 0, scale: 100, opacity: 100, fit: 'contain' };
  }
  function makeMediaClip(meta, track, start) {
    const type = meta.type;
    const dur = type === 'image' ? 5 : meta.duration || 5;
    const c = baseClip(type, track, start, dur);
    c.mediaId = meta.id;
    if (type === 'video' && meta.width && meta.height) {
      // 縦プロジェクトに横素材などは cover の方が自然なことが多いが、既定は全体表示
      c.fit = 'contain';
    }
    return c;
  }
  function defaultDesign() {
    if (st.libDesign && designById.has(st.libDesign)) return designById.get(st.libDesign);
    const pref = P.width < P.height ? DESIGNS.find((d) => d.pack === 'shorts-vol1') : null;
    return pref || DESIGNS[0];
  }
  function makeTelopClip(track, start, text, dur) {
    const d = defaultDesign();
    const c = baseClip('telop', track, start, dur || 3);
    c.designId = d ? d.id : null;
    c.variant = st.libDesign === (d && d.id) ? st.libVariant : 0;
    c.text = text != null ? text : (d && d.sample) || 'テロップ';
    c.sub = d && d.sampleSub ? d.sampleSub : '';
    c.fadeIn = 0.12; c.fadeOut = 0.12; c.anim = 'none';
    return c;
  }
  function firstTrack(kind) { return P.tracks.slice().reverse().find((t) => t.kind === kind) || null; }
  function trackEnd(trackId) { let e = 0; for (const c of P.clips) if (c.track === trackId) e = Math.max(e, clipEnd(c)); return e; }

  function appendMedia(id) {
    const meta = mediaMeta(id); if (!meta || !media.has(id)) return;
    const kind = kindForType(meta.type);
    const tr = kind === 'video' ? (trackById('V1') || firstTrack('video')) : (trackById('A1') || firstTrack('audio'));
    if (!tr) return;
    pushUndo();
    const c = makeMediaClip(meta, tr.id, trackEnd(tr.id));
    P.clips.push(c);
    st.sel = new Set([c.id]);
    changed({ structure: true });
  }

  /* =================================================================
     編集操作
     ================================================================= */
  function splitClipAt(c, t) {
    t = snapFrame(t);
    if (t <= c.start + MIN_DUR / 2 || t >= clipEnd(c) - MIN_DUR / 2) return null;
    const right = clone(c); right.id = uid('c');
    const leftDur = t - c.start;
    right.start = t; right.dur = c.dur - leftDur; right.in = (c.in || 0) + leftDur;
    c.dur = leftDur;
    // 分割点のフェードは消す（元クリップの先頭・末尾にだけ残す）
    right.fadeIn = 0; c.fadeOut = 0;
    if (c.type === 'telop') { right.fadeIn = 0; }
    P.clips.push(right);
    return right;
  }
  function splitAtPlayhead() {
    const t = st.time;
    let targets = P.clips.filter((c) => st.sel.has(c.id) && isActive(c, t));
    if (!targets.length) targets = P.clips.filter((c) => isActive(c, t) && !(trackById(c.track) || {}).locked);
    if (!targets.length) return toast('再生ヘッドの位置にクリップがありません');
    pushUndo();
    const news = [];
    for (const c of targets) { const r = splitClipAt(c, t); if (r) news.push(r); }
    if (news.length) st.sel = new Set(news.map((c) => c.id));
    changed({ structure: true });
  }
  function deleteSelected(ripple) {
    if (!st.sel.size) return;
    pushUndo();
    const del = P.clips.filter((c) => st.sel.has(c.id));
    P.clips = P.clips.filter((c) => !st.sel.has(c.id));
    if (ripple) {
      // トラックごとに、削除した区間を後ろから詰める
      const byTrack = {};
      for (const c of del) (byTrack[c.track] = byTrack[c.track] || []).push(c);
      for (const tid of Object.keys(byTrack)) {
        const ds = byTrack[tid].sort((a, b) => b.start - a.start);
        for (const d of ds) {
          for (const c of P.clips) if (c.track === tid && c.start >= clipEnd(d) - EPS) c.start = snapFrame(Math.max(0, c.start - d.dur));
        }
      }
    }
    st.sel.clear();
    changed({ structure: true });
  }
  function closeGaps() {
    let tids = new Set(P.clips.filter((c) => st.sel.has(c.id)).map((c) => c.track));
    if (!tids.size) tids = new Set(P.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
    pushUndo();
    for (const tid of tids) {
      let t = 0;
      for (const c of P.clips.filter((x) => x.track === tid).sort((a, b) => a.start - b.start)) { c.start = snapFrame(t); t = clipEnd(c); }
    }
    changed({ structure: true });
    toast('すき間を詰めました');
  }
  function copySel() {
    const cs = P.clips.filter((c) => st.sel.has(c.id));
    if (!cs.length) return;
    const t0 = Math.min(...cs.map((c) => c.start));
    st.clipboard = cs.map((c) => Object.assign(clone(c), { start: c.start - t0 }));
    toast(`${cs.length} 個のクリップをコピーしました`);
  }
  function paste() {
    if (!st.clipboard) return;
    pushUndo();
    const news = st.clipboard.map((c) => Object.assign(clone(c), { id: uid('c'), start: snapFrame(st.time + c.start) }));
    P.clips.push(...news);
    st.sel = new Set(news.map((c) => c.id));
    changed({ structure: true });
  }
  function duplicate() {
    const cs = P.clips.filter((c) => st.sel.has(c.id));
    if (!cs.length) return;
    pushUndo();
    const end = Math.max(...cs.map(clipEnd)), t0 = Math.min(...cs.map((c) => c.start));
    const news = cs.map((c) => Object.assign(clone(c), { id: uid('c'), start: snapFrame(end + (c.start - t0)) }));
    P.clips.push(...news);
    st.sel = new Set(news.map((c) => c.id));
    changed({ structure: true });
  }
  function editPoints() {
    const s = new Set([0]);
    for (const c of P.clips) { s.add(+c.start.toFixed(4)); s.add(+clipEnd(c).toFixed(4)); }
    return Array.from(s).sort((a, b) => a - b);
  }
  function addTrack(kind) {
    pushUndo();
    const prefix = kind === 'video' ? 'V' : kind === 'telop' ? 'T' : 'A';
    let n = 1; while (trackById(prefix + n)) n++;
    const t = { id: prefix + n, kind, muted: false, hidden: false };
    // 表示順：テロップ → ビデオ（上が前面） → オーディオ
    if (kind === 'audio') P.tracks.push(t);
    else {
      const idx = P.tracks.findIndex((x) => x.kind === kind);
      P.tracks.splice(idx < 0 ? 0 : idx, 0, t);
    }
    changed({ structure: true });
  }
  function removeTrack(id) {
    const t = trackById(id); if (!t) return;
    if (P.tracks.filter((x) => x.kind === t.kind).length <= 1) return toast('この種類の最後のトラックは削除できません');
    const n = P.clips.filter((c) => c.track === id).length;
    if (n && !confirm(`${id} には ${n} 個のクリップがあります。トラックごと削除しますか？`)) return;
    pushUndo();
    P.clips = P.clips.filter((c) => c.track !== id);
    P.tracks = P.tracks.filter((x) => x.id !== id);
    changed({ structure: true });
  }

  /* =================================================================
     テロップ描画キャッシュ
     ================================================================= */
  const telopCache = new Map(); // clipId → {key, canvas, rect}
  const fontReady = new Set();
  function telopKey(c, W, H) { return [c.designId, c.variant, c.text, c.sub, c.scale, W, H, fontReady.size].join('|'); }
  function telopCanvas(c, W, H) {
    const d = designById.get(c.designId);
    if (!d || !R) return null;
    const key = telopKey(c, W, H);
    let e = telopCache.get(c.id);
    if (e && e.key === key) return e;
    let canvas = e && e.canvas;
    if (!canvas) { canvas = document.createElement('canvas'); canvas.getContext('2d', { willReadFrequently: true }); }
    let rect = null;
    try {
      const out = R.render(canvas, d, { width: W, height: H, variant: c.variant || 0, text: c.text || '', sub: c.sub || '', scale: (c.scale || 100) / 100 });
      rect = out && out.rect;
      const b = R.contentBounds ? R.contentBounds(canvas, 4) : null;
      if (b && b.w > 0) rect = { x: b.x, y: b.y, w: b.w, h: b.h };
    } catch (err) { console.warn(err); }
    e = { key, canvas, rect };
    telopCache.set(c.id, e);
    ensureTelopFonts(d, c);
    return e;
  }
  function ensureTelopFonts(d, c) {
    const spec = R.resolve(d, c.variant || 0);
    const fams = [spec.font, spec.sub && spec.sub.font, spec.tag && spec.tag.font].filter(Boolean);
    const need = fams.filter((f) => !fontReady.has(R.fontString(f)));
    if (!need.length) return null;
    const p = R.ensureFonts(spec, [c.text || '', c.sub || '']).then(() => {
      let added = false;
      for (const f of need) { const k = R.fontString(f); if (!fontReady.has(k)) { fontReady.add(k); added = true; } }
      if (added) requestDraw();
    });
    return p;
  }

  /* =================================================================
     フレーム合成
     ================================================================= */
  const program = $('#program'), overlay = $('#overlay');
  const pctx = program.getContext('2d');
  const octx = overlay.getContext('2d');

  function visualRect(c, sw, sh, W, H) {
    const fit = c.fit === 'cover' ? Math.max(W / sw, H / sh) : c.fit === 'stretch' ? null : Math.min(W / sw, H / sh);
    const k = (c.scale || 100) / 100;
    let dw, dh;
    if (fit == null) { dw = W * k; dh = H * k; } else { dw = sw * fit * k; dh = sh * fit * k; }
    return { x: (W - dw) / 2 + (c.x || 0), y: (H - dh) / 2 + (c.y || 0), w: dw, h: dh };
  }
  function easeOutBack(x) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

  /** 合成順（下から）：オーディオ以外のトラックを表示順の逆に */
  function compositeTracks() { return P.tracks.filter((t) => t.kind !== 'audio').slice().reverse(); }

  function drawFrame(ctx, t, opt) {
    opt = opt || {};
    const W = P.width, H = P.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const rects = {};
    for (const tr of compositeTracks()) {
      if (tr.hidden) continue;
      const cs = P.clips.filter((c) => c.track === tr.id && isActive(c, t)).sort((a, b) => a.start - b.start);
      for (const c of cs) {
        const alpha = clamp((c.opacity == null ? 100 : c.opacity) / 100, 0, 1) * fadeFactor(c, t);
        if (alpha <= 0.001) continue;
        ctx.globalAlpha = alpha;
        if (c.type === 'video' || c.type === 'image') {
          let src = null, sw = 0, sh = 0;
          if (c.type === 'video') {
            const el = opt.players ? opt.players.get(c.id) : (players.get(c.id) || {}).el;
            if (el && el.readyState >= 2) { src = el; sw = el.videoWidth; sh = el.videoHeight; }
          } else {
            const rt = media.get(c.mediaId);
            if (rt && rt.img) { src = rt.img; sw = rt.img.naturalWidth; sh = rt.img.naturalHeight; }
          }
          if (!src || !sw) {
            if (!media.has(c.mediaId)) { ctx.globalAlpha = 1; drawMissing(ctx, W, H); }
            continue;
          }
          const r = visualRect(c, sw, sh, W, H);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(src, r.x, r.y, r.w, r.h);
          rects[c.id] = r;
        } else if (c.type === 'telop') {
          const e = telopCanvas(c, W, H);
          if (!e) continue;
          const p = (t - c.start);
          const ad = 0.35;
          ctx.save();
          let ox = c.x || 0, oy = c.y || 0;
          const r = e.rect || { x: 0, y: 0, w: W, h: H };
          if (c.anim === 'pop' && p < ad) {
            const k = 0.6 + 0.4 * easeOutBack(clamp(p / ad, 0, 1));
            const cx = r.x + r.w / 2 + ox, cy = r.y + r.h / 2 + oy;
            ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
          } else if (c.anim === 'slideUp' && p < ad) {
            oy += (1 - easeOutCubic(clamp(p / ad, 0, 1))) * 60;
            ctx.globalAlpha *= clamp(p / ad * 1.5, 0, 1);
          } else if (c.anim === 'slideLeft' && p < ad) {
            ox += (1 - easeOutCubic(clamp(p / ad, 0, 1))) * W * 0.35;
          } else if (c.anim === 'wipe' && p < ad * 1.4) {
            const k = easeOutCubic(clamp(p / (ad * 1.4), 0, 1));
            ctx.beginPath(); ctx.rect(r.x + ox - 4, 0, (r.w + 8) * k, H); ctx.clip();
          } else if (c.anim === 'type') {
            // 1文字ずつ（表示率で横方向にクリップ）
            const chars = Math.max(1, (c.text || '').replace(/\n/g, '').length);
            const k = clamp(p / Math.min(c.dur * 0.6, chars * 0.07), 0, 1);
            if (k < 1) { ctx.beginPath(); ctx.rect(r.x + ox - 4, 0, (r.w + 8) * k, H); ctx.clip(); }
          }
          ctx.drawImage(e.canvas, ox, oy);
          ctx.restore();
          rects[c.id] = { x: r.x + (c.x || 0), y: r.y + (c.y || 0), w: r.w, h: r.h };
        }
      }
    }
    ctx.restore();
    return rects;
  }
  function drawMissing(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = '#3a1414'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff8a8d'; ctx.font = `700 ${Math.round(H / 22)}px system-ui,sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('素材が見つかりません（再リンクしてください）', W / 2, H / 2);
    ctx.restore();
  }

  let lastRects = {};
  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }
  function draw() {
    lastRects = drawFrame(pctx, st.time);
    drawOverlay();
    updateTimeUI();
  }
  function drawOverlay() {
    const W = P.width, H = P.height;
    octx.clearRect(0, 0, W, H);
    if (st.safe) {
      octx.save();
      octx.strokeStyle = 'rgba(255,255,255,.45)'; octx.setLineDash([12, 10]); octx.lineWidth = Math.max(2, W / 640);
      const a = 0.05, t = 0.1;
      octx.strokeRect(W * a, H * a, W * (1 - 2 * a), H * (1 - 2 * a));
      octx.strokeStyle = 'rgba(255,216,77,.55)';
      octx.strokeRect(W * t, H * t, W * (1 - 2 * t), H * (1 - 2 * t));
      if (W < H) {
        // 縦動画：SNSアプリのUIがかぶりやすい領域
        octx.setLineDash([]); octx.fillStyle = 'rgba(229,72,77,.18)';
        octx.fillRect(0, H * 0.78, W, H * 0.22);
        octx.fillRect(W * 0.84, H * 0.35, W * 0.16, H * 0.43);
        octx.fillRect(0, 0, W, H * 0.08);
        octx.fillStyle = 'rgba(255,255,255,.7)'; octx.font = `600 ${Math.round(W / 36)}px system-ui,sans-serif`;
        octx.fillText('UI が重なりやすい範囲', W * 0.04, H * 0.8 + W / 30);
      }
      octx.restore();
    }
    if (!st.playing) {
      for (const id of st.sel) {
        const r = lastRects[id]; if (!r) continue;
        octx.save();
        octx.strokeStyle = '#2d8ceb'; octx.lineWidth = Math.max(2, W / 700);
        octx.strokeRect(r.x, r.y, r.w, r.h);
        const hs = Math.max(10, W / 120);
        octx.fillStyle = '#fff';
        for (const [hx, hy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) octx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        octx.restore();
      }
    }
  }

  /* =================================================================
     再生エンジン（プレビュー）
     ================================================================= */
  const players = new Map(); // clipId → {el, gain, node, mediaId}
  function getPlayer(c) {
    let p = players.get(c.id);
    if (p && p.mediaId === c.mediaId) return p;
    if (p) disposePlayer(c.id);
    const rt = media.get(c.mediaId);
    if (!rt) return null;
    const el = document.createElement(c.type === 'audio' ? 'audio' : 'video');
    el.preload = 'auto'; el.playsInline = true; el.src = rt.url; el.crossOrigin = 'anonymous';
    if (c.type === 'video') el.muted = !rt.meta.hasAudio;
    p = { el, gain: null, node: null, mediaId: c.mediaId };
    if (rt.meta.hasAudio) {
      try {
        const ctx = actx();
        p.node = ctx.createMediaElementSource(el);
        p.gain = ctx.createGain();
        p.node.connect(p.gain); p.gain.connect(masterGain);
      } catch (e) { /* フォールバック：要素の音量で */ }
    }
    el.addEventListener('seeked', () => { if (!st.playing) requestDraw(); });
    el.addEventListener('loadeddata', () => requestDraw());
    players.set(c.id, p);
    return p;
  }
  function disposePlayer(id) {
    const p = players.get(id); if (!p) return;
    try { p.el.pause(); } catch (e) { /* ignore */ }
    try { if (p.node) p.node.disconnect(); if (p.gain) p.gain.disconnect(); } catch (e) { /* ignore */ }
    p.el.removeAttribute('src'); try { p.el.load(); } catch (e) { /* ignore */ }
    players.delete(id);
  }

  function syncMedia(t, playing) {
    const live = new Set();
    for (const c of P.clips) {
      if (c.type !== 'video' && c.type !== 'audio') continue;
      const tr = trackById(c.track); if (!tr) continue;
      const near = t >= c.start - 2 && t < clipEnd(c) + 0.5;
      if (!near) continue;
      if (c.type === 'video' && tr.hidden && !(media.get(c.mediaId) || {}).meta?.hasAudio) continue;
      const p = getPlayer(c); if (!p) continue;
      live.add(c.id);
      const el = p.el;
      const active = isActive(c, t);
      const target = (c.in || 0) + (t - c.start);
      const vol = (tr.muted ? 0 : (c.volume == null ? 1 : c.volume)) * fadeFactor(c, t);
      if (p.gain) p.gain.gain.value = vol; else el.volume = clamp(vol, 0, 1);
      if (active) {
        if (playing && st.rate > 0) {
          if (el.playbackRate !== st.rate) el.playbackRate = st.rate;
          if (el.paused) { if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target; el.play().catch(() => {}); }
          else if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target;
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - target) > 0.5 / fps()) el.currentTime = target;
        }
      } else {
        if (!el.paused) el.pause();
        if (t < c.start && Math.abs(el.currentTime - (c.in || 0)) > 0.05 && !el.seeking) el.currentTime = c.in || 0;
      }
    }
    for (const id of Array.from(players.keys())) if (!live.has(id)) disposePlayer(id);
  }

  let rafId = 0, playT0 = 0, playP0 = 0;
  function play() {
    if (st.playing) return;
    if (!P.clips.length) return toast('タイムラインが空です。素材を読み込んで配置してください');
    const ctx = actx(); if (ctx.state === 'suspended') ctx.resume();
    if (st.time >= duration() - 1 / fps()) st.time = 0;
    st.playing = true; playT0 = st.time; playP0 = performance.now();
    $('#ico-play').innerHTML = '<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>';
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }
  function pause() {
    if (!st.playing) return;
    st.playing = false; st.rate = 1;
    cancelAnimationFrame(rafId);
    st.time = snapFrame(st.time);
    $('#ico-play').innerHTML = '<path d="M7 4v16l13-8z"/>';
    syncMedia(st.time, false);
    requestDraw();
  }
  function tick(now) {
    if (!st.playing) return;
    let t = playT0 + (now - playP0) / 1000 * st.rate;
    const end = duration();
    if (t >= end) {
      if (st.loop && end > 0) { t = 0; playT0 = 0; playP0 = now; }
      else { st.time = end; pause(); return; }
    }
    if (t < 0) { st.time = 0; pause(); return; }
    st.time = t;
    syncMedia(t, true);
    lastRects = drawFrame(pctx, t);
    drawOverlay();
    updateTimeUI();
    followPlayhead();
    rafId = requestAnimationFrame(tick);
  }
  function seek(t, keepPlaying) {
    st.time = clamp(t, 0, Math.max(duration(), 0));
    if (st.playing) { playT0 = st.time; playP0 = performance.now(); if (!keepPlaying) { /* 継続 */ } }
    syncMedia(st.time, st.playing);
    requestDraw();
  }
  function togglePlay() { st.playing ? pause() : (st.rate = 1, play()); }
  function shuttle(dir) {
    if (dir === 0) return pause();
    if (dir > 0) {
      if (!st.playing) { st.rate = 1; play(); return; }
      if (st.rate < 0) { st.rate = 1; } else st.rate = Math.min(8, st.rate * 2);
      playT0 = st.time; playP0 = performance.now();
    } else {
      // 逆再生：メディアは止めてスクラブで表示
      if (!st.playing) { st.rate = -1; play(); } else { st.rate = st.rate > 0 ? -1 : Math.max(-8, st.rate * 2); }
      playT0 = st.time; playP0 = performance.now();
    }
    if (st.rate < 0) for (const p of players.values()) p.el.pause();
  }

  /* =================================================================
     レベルメーター
     ================================================================= */
  const meterC = $('#meter-c'), mctx = meterC.getContext('2d');
  const meterBuf = new Float32Array(1024);
  let peakHold = [0, 0];
  function drawMeter() {
    const w = meterC.clientWidth, h = meterC.clientHeight;
    if (meterC.width !== w * 2 || meterC.height !== h * 2) { meterC.width = w * 2; meterC.height = h * 2; }
    const W = meterC.width, H = meterC.height;
    mctx.clearRect(0, 0, W, H);
    const lv = [0, 0];
    if (analyserL && st.playing) {
      [analyserL, analyserR].forEach((a, i) => {
        a.getFloatTimeDomainData(meterBuf);
        let s = 0; for (let k = 0; k < meterBuf.length; k++) s += meterBuf[k] * meterBuf[k];
        const rms = Math.sqrt(s / meterBuf.length);
        const db = 20 * Math.log10(rms + 1e-9);
        lv[i] = clamp((db + 60) / 60, 0, 1);
      });
    }
    const bw = W / 2 - 6;
    for (let i = 0; i < 2; i++) {
      peakHold[i] = Math.max(lv[i], peakHold[i] - 0.01);
      const x = 3 + i * (bw + 6);
      mctx.fillStyle = '#111'; mctx.fillRect(x, 0, bw, H);
      const g = mctx.createLinearGradient(0, H, 0, 0);
      g.addColorStop(0, '#2fbf71'); g.addColorStop(0.7, '#2fbf71'); g.addColorStop(0.85, '#f0b429'); g.addColorStop(1, '#e5484d');
      mctx.fillStyle = g; mctx.fillRect(x, H * (1 - lv[i]), bw, H * lv[i]);
      mctx.fillStyle = '#fff'; mctx.fillRect(x, H * (1 - peakHold[i]) - 2, bw, 2);
    }
    mctx.fillStyle = 'rgba(255,255,255,.25)';
    for (const db of [-6, -12, -24, -36, -48]) { const y = H * (-db / 60); mctx.fillRect(0, y, W, 1); }
    requestAnimationFrame(drawMeter);
  }

  /* =================================================================
     モニターのレイアウトと操作
     ================================================================= */
  function layoutMonitor() {
    const stage = $('#mon-stage');
    const sw = stage.clientWidth - 24, sh = stage.clientHeight - 24;
    const k = Math.min(sw / P.width, sh / P.height);
    const wrap = $('#mon-wrap');
    wrap.style.width = Math.max(10, Math.floor(P.width * k)) + 'px';
    wrap.style.height = Math.max(10, Math.floor(P.height * k)) + 'px';
    if (program.width !== P.width || program.height !== P.height) {
      program.width = overlay.width = P.width; program.height = overlay.height = P.height;
      telopCache.clear();
    }
    $('#mon-res').textContent = `${P.width}×${P.height} ・ ${P.fps}fps ・ 表示 ${Math.round(k * 100)}%`;
    requestDraw();
  }
  function monitorPoint(e) {
    const r = overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * P.width, y: (e.clientY - r.top) / r.height * P.height };
  }
  overlay.addEventListener('pointerdown', (e) => {
    if (st.playing) return;
    const pt = monitorPoint(e);
    // 前面から当たり判定
    const order = [];
    for (const tr of compositeTracks()) for (const c of P.clips.filter((x) => x.track === tr.id && isActive(x, st.time))) order.push(c);
    let hit = null;
    for (let i = order.length - 1; i >= 0; i--) {
      const r = lastRects[order[i].id];
      if (r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) { hit = order[i]; break; }
    }
    if (!hit) { if (!e.shiftKey) { st.sel.clear(); changed({ selection: true }); } return; }
    if (!st.sel.has(hit.id)) { st.sel = e.shiftKey ? new Set([...st.sel, hit.id]) : new Set([hit.id]); changed({ selection: true }); }
    const r0 = lastRects[hit.id];
    const corner = r0 && [[r0.x, r0.y], [r0.x + r0.w, r0.y], [r0.x, r0.y + r0.h], [r0.x + r0.w, r0.y + r0.h]].some(([hx, hy]) => Math.abs(hx - pt.x) < P.width / 60 && Math.abs(hy - pt.y) < P.width / 60);
    const start = { x: hit.x || 0, y: hit.y || 0, scale: hit.scale || 100 };
    const cx = r0 ? r0.x + r0.w / 2 : P.width / 2, cy = r0 ? r0.y + r0.h / 2 : P.height / 2;
    const d0 = Math.hypot(pt.x - cx, pt.y - cy) || 1;
    let moved = false;
    overlay.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const q = monitorPoint(ev);
      if (!moved) { pushUndo(); moved = true; }
      if (corner) {
        hit.scale = clamp(Math.round(start.scale * Math.hypot(q.x - cx, q.y - cy) / d0), 5, 800);
      } else {
        let nx = Math.round(start.x + q.x - pt.x), ny = Math.round(start.y + q.y - pt.y);
        if (!ev.altKey && hit.type !== 'telop') { if (Math.abs(nx) < 12) nx = 0; if (Math.abs(ny) < 12) ny = 0; }
        if (ev.shiftKey) { if (Math.abs(nx - start.x) > Math.abs(ny - start.y)) ny = start.y; else nx = start.x; }
        hit.x = nx; hit.y = ny;
      }
      requestDraw(); renderInspectorValues();
    };
    const up = () => {
      overlay.removeEventListener('pointermove', move); overlay.removeEventListener('pointerup', up);
      if (moved) changed({ props: true });
    };
    overlay.addEventListener('pointermove', move); overlay.addEventListener('pointerup', up);
  });
  overlay.addEventListener('pointermove', (e) => {
    if (st.playing || e.buttons) return;
    const pt = monitorPoint(e);
    let cur = 'default';
    for (const id of st.sel) {
      const r = lastRects[id]; if (!r) continue;
      const near = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].some(([hx, hy]) => Math.abs(hx - pt.x) < P.width / 60 && Math.abs(hy - pt.y) < P.width / 60);
      if (near) { cur = 'nwse-resize'; break; }
      if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) cur = 'move';
    }
    overlay.style.cursor = cur;
  });

  /* スクラブバー */
  (function () {
    const bar = $('#scrubbar');
    const at = (e) => { const r = bar.getBoundingClientRect(); seek(clamp((e.clientX - r.left) / r.width, 0, 1) * duration()); };
    bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); at(e); bar.onpointermove = at; });
    bar.addEventListener('pointerup', () => { bar.onpointermove = null; });
  })();

  function updateTimeUI() {
    const d = duration();
    $('#tc-cur').textContent = tc(st.time);
    $('#tl-tc').textContent = tc(st.time);
    $('#tc-total').textContent = tc(d);
    $('#scrubbar .fill').style.width = (d > 0 ? clamp(st.time / d, 0, 1) * 100 : 0) + '%';
    $('#playhead').style.left = `calc(var(--tl-head) + ${st.time * st.pps}px)`;
  }

  /* =================================================================
     タイムライン
     ================================================================= */
  const scroller = $('#tl-scroll'), rows = $('#tl-rows'), content = $('#tl-content');
  const ruler = $('#tl-ruler'), rctx = ruler.getContext('2d');
  const TRACK_H = { video: 62, telop: 38, audio: 50 };
  const HEAD_W = 150;

  const ICON = {
    eye: '<svg viewBox="0 0 24 24"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 4.3L4.3 3 21 19.7 19.7 21l-3.1-3.1A11 11 0 0112 19C6 19 2 12 2 12a18 18 0 014.4-5.1zM12 5c6 0 10 7 10 7a18 18 0 01-3 3.9L8.6 5.5A10 10 0 0112 5z"/></svg>',
    spk: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0014 8v8a4.5 4.5 0 002.5-4z"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.6 3l2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
  };
  const TRACK_COL = { video: '#4a6fa5', telop: '#b5692e', audio: '#3d8a5f' };
  const TRACK_LBL = { video: 'ビデオ', telop: 'テロップ', audio: 'オーディオ' };

  function contentWidth() { return Math.max(scroller.clientWidth - HEAD_W, (duration() + 30) * st.pps); }

  function renderTimeline() {
    content.style.width = (HEAD_W + contentWidth()) + 'px';
    let html = '';
    for (const tr of P.tracks) {
      const h = TRACK_H[tr.kind];
      const vis = tr.kind === 'audio'
        ? `<button class="ib ${tr.muted ? 'off' : ''}" data-tmute="${tr.id}" title="ミュート">${tr.muted ? ICON.mute : ICON.spk}</button>`
        : `<button class="ib ${tr.hidden ? 'off' : ''}" data-thide="${tr.id}" title="表示／非表示">${tr.hidden ? ICON.eyeOff : ICON.eye}</button>` +
          (tr.kind === 'video' ? `<button class="ib ${tr.muted ? 'off' : ''}" data-tmute="${tr.id}" title="このトラックの音声をミュート">${tr.muted ? ICON.mute : ICON.spk}</button>` : '');
      html += `<div class="trow k-${tr.kind}" data-track="${tr.id}" style="height:${h}px">
        <div class="thead"><span class="tn" style="background:${TRACK_COL[tr.kind]}">${tr.id}</span><span class="tl">${TRACK_LBL[tr.kind]}</span>${vis}<button class="ib tdel" data-tdel="${tr.id}" title="トラックを削除">${ICON.x}</button></div>
        <div class="lane" data-lane="${tr.id}"></div></div>`;
    }
    rows.innerHTML = html;
    for (const c of P.clips) {
      const lane = rows.querySelector(`[data-lane="${c.track}"]`);
      if (!lane) continue;
      lane.appendChild(clipEl(c));
    }
    content.classList.toggle('razor', st.tool === 'razor');
    drawRuler();
    updateTimeUI();
  }

  function clipLabel(c) {
    if (c.type === 'telop') return (c.text || '').replace(/\n/g, ' ') || '（空のテロップ）';
    const m = mediaMeta(c.mediaId);
    return m ? m.name : '（素材なし）';
  }
  function clipEl(c) {
    const el = document.createElement('div');
    const tr = trackById(c.track);
    const rt = media.get(c.mediaId);
    el.className = `clip t-${c.type}` + (st.sel.has(c.id) ? ' sel' : '') + (tr && (tr.hidden || tr.muted) && (tr.kind !== 'video' || tr.hidden) ? ' off' : '') + (c.type !== 'telop' && !rt ? ' unlinked' : '');
    el.dataset.clip = c.id;
    el.style.left = (c.start * st.pps) + 'px';
    el.style.width = Math.max(2, c.dur * st.pps) + 'px';
    if (rt && rt.thumb && (c.type === 'video' || c.type === 'image')) {
      el.style.backgroundImage = `url(${rt.thumb})`;
      el.style.backgroundSize = 'auto 62%'; el.style.backgroundPosition = '0 16px';
    }
    let inner = `<div class="cl">${escapeHtml(clipLabel(c))}${c.volume != null && c.volume !== 1 && c.type !== 'telop' && c.type !== 'image' ? ` ・ ${volToDb(c.volume)}dB` : ''}</div>`;
    if (c.fadeIn > 0) inner += `<div class="fade i" style="width:${c.fadeIn * st.pps}px"></div>`;
    if (c.fadeOut > 0) inner += `<div class="fade o" style="width:${c.fadeOut * st.pps}px"></div>`;
    inner += '<div class="eh l"></div><div class="eh r"></div>';
    el.innerHTML = inner;
    if (rt && rt.peaks && (c.type === 'audio' || c.type === 'video')) {
      const cv = document.createElement('canvas'); cv.className = 'wf';
      const w = Math.min(4000, Math.max(2, Math.round(c.dur * st.pps)));
      const h = c.type === 'audio' ? TRACK_H.audio - 20 : 18;
      cv.width = w; cv.height = h; cv.style.height = h + 'px';
      const g = cv.getContext('2d');
      g.fillStyle = c.type === 'audio' ? 'rgba(190,255,215,.75)' : 'rgba(200,225,255,.7)';
      if (c.type === 'video') { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(160,220,190,.85)'; }
      const pk = rt.peaks, per = 50, vol = Math.min(2, c.volume == null ? 1 : c.volume);
      for (let x = 0; x < w; x++) {
        const ts = (c.in || 0) + (x / w) * c.dur;
        const te = (c.in || 0) + ((x + 1) / w) * c.dur;
        let mx = 0;
        for (let i = Math.floor(ts * per); i <= Math.floor(te * per) && i < pk.length; i++) if (pk[i] > mx) mx = pk[i];
        const a = Math.min(1, (mx / 255) * vol) * h;
        if (c.type === 'audio') g.fillRect(x, (h - a) / 2, 1, Math.max(1, a));
        else g.fillRect(x, h - a, 1, Math.max(1, a));
      }
      el.appendChild(cv);
    }
    return el;
  }

  function drawRuler() {
    const vw = Math.max(50, scroller.clientWidth - HEAD_W);
    const dpr = window.devicePixelRatio || 1;
    ruler.style.width = vw + 'px';
    if (ruler.width !== Math.round(vw * dpr)) { ruler.width = Math.round(vw * dpr); ruler.height = Math.round(26 * dpr); }
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rctx.clearRect(0, 0, vw, 26);
    rctx.fillStyle = '#1e1e1e'; rctx.fillRect(0, 0, vw, 26);
    const x0 = scroller.scrollLeft;
    const t0 = x0 / st.pps, t1 = (x0 + vw) / st.pps;
    const steps = [1 / fps(), 2 / fps(), 5 / fps(), 10 / fps(), 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    let major = steps.find((s) => s * st.pps >= 80) || 600;
    const minor = major / (major >= 1 ? (major % 5 === 0 ? 5 : 2) : 2);
    rctx.strokeStyle = '#555'; rctx.fillStyle = '#9a9a9a';
    rctx.font = '10px ui-monospace,Menlo,Consolas,monospace';
    rctx.beginPath();
    for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) {
      const x = Math.round(t * st.pps - x0) + 0.5;
      const isMaj = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      rctx.moveTo(x, isMaj ? 12 : 19); rctx.lineTo(x, 26);
      if (isMaj) rctx.fillText(tc(t).replace(/^00:/, ''), x + 3, 10);
    }
    rctx.stroke();
    // 編集点の印
    const end = duration();
    const ex = end * st.pps - x0;
    if (ex >= 0 && ex <= vw) { rctx.fillStyle = 'rgba(229,72,77,.6)'; rctx.fillRect(ex, 20, 2, 6); }
  }

  function followPlayhead() {
    const x = st.time * st.pps;
    const vw = scroller.clientWidth - HEAD_W;
    if (x < scroller.scrollLeft || x > scroller.scrollLeft + vw - 30) scroller.scrollLeft = Math.max(0, x - 60);
  }

  function setZoom(pps, anchorT) {
    const vw = scroller.clientWidth - HEAD_W;
    if (anchorT == null) anchorT = st.time;
    const ax = anchorT * st.pps - scroller.scrollLeft;
    st.pps = clamp(pps, 2, 600);
    $('#zoom').value = Math.round(Math.log(st.pps / 2) / Math.log(300) * 100);
    renderTimeline();
    scroller.scrollLeft = Math.max(0, anchorT * st.pps - clamp(ax, 0, vw));
    drawRuler();
  }
  function zoomFit() {
    const vw = scroller.clientWidth - HEAD_W - 40;
    const d = Math.max(5, duration());
    setZoom(vw / d, 0); scroller.scrollLeft = 0; drawRuler();
  }
  $('#zoom').addEventListener('input', (e) => setZoom(2 * Math.pow(300, e.target.value / 100)));
  scroller.addEventListener('scroll', () => drawRuler());
  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      const r = scroller.getBoundingClientRect();
      const t = (e.clientX - r.left - HEAD_W + scroller.scrollLeft) / st.pps;
      setZoom(st.pps * (e.deltaY < 0 ? 1.18 : 1 / 1.18), Math.max(0, t));
    } else if (e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
      e.preventDefault(); scroller.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  function timeAtX(clientX) {
    const r = scroller.getBoundingClientRect();
    return Math.max(0, (clientX - r.left - HEAD_W + scroller.scrollLeft) / st.pps);
  }
  function trackAtY(clientY) {
    for (const row of $$('.trow', rows)) {
      const r = row.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return trackById(row.dataset.track);
    }
    return null;
  }

  /* ルーラー：スクラブ */
  ruler.addEventListener('pointerdown', (e) => {
    ruler.setPointerCapture(e.pointerId);
    const was = st.playing; if (was) pause();
    const go = (ev) => seek(snapFrame(timeAtX(ev.clientX)));
    go(e);
    ruler.onpointermove = go;
    ruler.onpointerup = () => { ruler.onpointermove = null; };
  });

  /* スナップ */
  function snapCandidates(excludeIds) {
    const s = [0, st.time];
    for (const c of P.clips) { if (excludeIds.has(c.id)) continue; s.push(c.start, clipEnd(c)); }
    return s;
  }
  function snapTo(t, cands) {
    if (!st.snap) return { t, hit: null };
    const th = 8 / st.pps;
    let best = null, bd = th;
    for (const c of cands) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
    return best == null ? { t, hit: null } : { t: best, hit: best };
  }
  function showSnap(t) {
    const l = $('#snapline');
    if (t == null) { l.style.display = 'none'; return; }
    l.style.display = 'block'; l.style.left = `calc(var(--tl-head) + ${t * st.pps}px)`;
  }

  /* クリップのドラッグ・トリム・レーザー */
  rows.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button');
    if (btn) {
      const tid = btn.dataset.tmute || btn.dataset.thide || btn.dataset.tdel;
      const tr = trackById(tid); if (!tr) return;
      if (btn.dataset.tdel) { removeTrack(tid); return; }
      pushUndo();
      if (btn.dataset.tmute) tr.muted = !tr.muted; else tr.hidden = !tr.hidden;
      changed({ structure: true });
      return;
    }
    if (e.target.closest('.thead')) return;
    const clipDiv = e.target.closest('.clip');
    const t = timeAtX(e.clientX);
    if (!clipDiv) {
      // 空き領域：再生ヘッド移動＋範囲選択
      if (st.playing) pause();
      if (!e.shiftKey) st.sel.clear();
      seek(snapFrame(t));
      startMarquee(e);
      changed({ selection: true });
      return;
    }
    const c = clipById(clipDiv.dataset.clip); if (!c) return;
    if (st.tool === 'razor') {
      let tt = snapFrame(t);
      if (e.shiftKey) {
        pushUndo();
        for (const x of P.clips.filter((x) => isActive(x, tt))) splitClipAt(x, tt);
      } else {
        const sn = snapTo(tt, snapCandidates(new Set([c.id]))); tt = sn.t;
        pushUndo(); splitClipAt(c, tt);
      }
      changed({ structure: true });
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (st.sel.has(c.id)) st.sel.delete(c.id); else st.sel.add(c.id);
      changed({ selection: true });
      return;
    }
    if (!st.sel.has(c.id)) { st.sel = new Set([c.id]); changed({ selection: true }); }
    const edge = e.target.classList.contains('eh') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
    beginClipDrag(e, c, edge);
  });

  function maxSourceDur(c) {
    if (c.type === 'video' || c.type === 'audio') {
      const m = mediaMeta(c.mediaId);
      if (m && isFinite(m.duration) && m.duration > 0) return m.duration;
    }
    return Infinity;
  }

  function beginClipDrag(e, c, edge) {
    const sx = e.clientX, sy = e.clientY;
    const sel = P.clips.filter((x) => st.sel.has(x.id));
    const orig = new Map(sel.map((x) => [x.id, { start: x.start, dur: x.dur, in: x.in || 0, track: x.track }]));
    const o = orig.get(c.id);
    const exclude = new Set(sel.map((x) => x.id));
    const cands = snapCandidates(exclude);
    const ripple = st.tool === 'ripple';
    const followers = ripple && edge === 'r' ? P.clips.filter((x) => x.track === c.track && x.id !== c.id && x.start >= o.start + o.dur - EPS).map((x) => [x, x.start]) : [];
    const followersL = ripple && edge === 'l' ? P.clips.filter((x) => x.track === c.track && x.id !== c.id && x.start >= o.start + o.dur - EPS).map((x) => [x, x.start]) : [];
    let moved = false;
    const snapStr = snapshot();
    rows.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - sx;
      if (!moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - sy) < 4) return;
      moved = true;
      let dt = dx / st.pps;
      let snapHit = null;
      if (edge === 'r') {
        let end = o.start + o.dur + dt;
        const sn = snapTo(end, cands); end = sn.t; snapHit = sn.hit;
        const maxD = maxSourceDur(c) - o.in;
        c.dur = snapFrame(clamp(end - o.start, MIN_DUR, maxD));
        const delta = c.dur - o.dur;
        for (const [x, s0] of followers) x.start = snapFrame(Math.max(0, s0 + delta));
      } else if (edge === 'l') {
        let st0 = o.start + dt;
        const sn = snapTo(st0, cands); st0 = sn.t; snapHit = sn.hit;
        let delta = st0 - o.start;
        const isMedia = c.type === 'video' || c.type === 'audio';
        delta = clamp(delta, isMedia ? -o.in : -o.start, o.dur - MIN_DUR);
        delta = Math.max(delta, -o.start);
        if (ripple) {
          // リップル：開始位置は固定、素材の頭を詰めて後ろを前に送る
          c.in = o.in + delta; c.dur = snapFrame(o.dur - delta); c.start = o.start;
          for (const [x, s0] of followersL) x.start = snapFrame(Math.max(0, s0 - delta));
        } else {
          c.start = snapFrame(o.start + delta); c.in = o.in + delta; c.dur = snapFrame(o.dur - delta);
        }
        if (c.type === 'image' || c.type === 'telop') c.in = 0;
      } else {
        // 移動：スナップは選択の先頭と末尾どちらでも
        const minStart = Math.min(...sel.map((x) => orig.get(x.id).start));
        dt = Math.max(dt, -minStart);
        let ns = o.start + dt;
        const s1 = snapTo(ns, cands), s2 = snapTo(ns + o.dur, cands);
        if (s1.hit != null && (s2.hit == null || Math.abs(s1.t - ns) <= Math.abs(s2.t - (ns + o.dur)))) { dt = s1.t - o.start; snapHit = s1.hit; }
        else if (s2.hit != null) { dt = s2.t - o.dur - o.start; snapHit = s2.hit; }
        for (const x of sel) { const ox = orig.get(x.id); x.start = snapFrame(Math.max(0, ox.start + dt)); }
        if (sel.length === 1) {
          const tr = trackAtY(ev.clientY);
          if (tr && tr.kind === trackById(o.track).kind) c.track = tr.id;
        }
      }
      showSnap(snapHit);
      renderTimeline();
      if (!st.playing) requestDraw();
    };
    const up = () => {
      rows.removeEventListener('pointermove', move); rows.removeEventListener('pointerup', up);
      showSnap(null);
      if (moved) {
        undoStack.push(snapStr); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; lastCoalesce.key = null;
        changed({ structure: true });
      }
    };
    rows.addEventListener('pointermove', move); rows.addEventListener('pointerup', up);
  }

  function startMarquee(e) {
    const mq = $('#marquee');
    const cr = content.getBoundingClientRect();
    const x0 = e.clientX - cr.left, y0 = e.clientY - cr.top;
    let active = false;
    rows.setPointerCapture(e.pointerId);
    const base = new Set(st.sel);
    const move = (ev) => {
      const x1 = ev.clientX - cr.left, y1 = ev.clientY - cr.top;
      if (!active && Math.hypot(x1 - x0, y1 - y0) < 5) return;
      active = true;
      const L = Math.min(x0, x1), T = Math.min(y0, y1), Wd = Math.abs(x1 - x0), Hd = Math.abs(y1 - y0);
      Object.assign(mq.style, { display: 'block', left: L + 'px', top: T + 'px', width: Wd + 'px', height: Hd + 'px' });
      const sel = new Set(base);
      for (const el of $$('.clip', rows)) {
        const r = el.getBoundingClientRect();
        const rl = r.left - cr.left, rt = r.top - cr.top;
        if (rl < L + Wd && rl + r.width > L && rt < T + Hd && rt + r.height > T) sel.add(el.dataset.clip);
      }
      st.sel = sel;
      for (const el of $$('.clip', rows)) el.classList.toggle('sel', sel.has(el.dataset.clip));
    };
    const up = () => {
      rows.removeEventListener('pointermove', move); rows.removeEventListener('pointerup', up);
      mq.style.display = 'none';
      if (active) changed({ selection: true });
    };
    rows.addEventListener('pointermove', move); rows.addEventListener('pointerup', up);
  }

  /* レーザーのガイド線 */
  rows.addEventListener('pointermove', (e) => {
    const l = $('#razorline');
    if (st.tool !== 'razor' || e.buttons) { l.style.display = 'none'; return; }
    const t = snapFrame(timeAtX(e.clientX));
    l.style.display = 'block'; l.style.left = `calc(var(--tl-head) + ${t * st.pps}px)`;
  });
  rows.addEventListener('pointerleave', () => { $('#razorline').style.display = 'none'; });
  rows.addEventListener('dblclick', (e) => {
    const cd = e.target.closest('.clip');
    if (cd) { const c = clipById(cd.dataset.clip); if (c) { seek(c.start); if (c.type === 'telop') setTimeout(() => { const ta = $('#insp textarea'); if (ta) { ta.focus(); ta.select(); } }, 30); } }
  });

  /* ドラッグ＆ドロップ（ビン／テロップ → タイムライン、OSファイル → どこでも） */
  rows.addEventListener('dragover', (e) => {
    const types = e.dataTransfer.types;
    if (!types.includes('text/x-cc-media') && !types.includes('text/x-cc-telop') && !types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const tr = trackAtY(e.clientY);
    $$('.trow', rows).forEach((r) => r.classList.toggle('dropok', !!tr && r.dataset.track === tr.id));
    showSnap(snapTo(timeAtX(e.clientX), snapCandidates(new Set())).hit);
  });
  rows.addEventListener('dragleave', (e) => { if (!rows.contains(e.relatedTarget)) { $$('.trow', rows).forEach((r) => r.classList.remove('dropok')); showSnap(null); } });
  rows.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation();
    $$('.trow', rows).forEach((r) => r.classList.remove('dropok')); showSnap(null);
    const t = snapFrame(snapTo(timeAtX(e.clientX), snapCandidates(new Set())).t);
    let tr = trackAtY(e.clientY);
    const mid = e.dataTransfer.getData('text/x-cc-media');
    const did = e.dataTransfer.getData('text/x-cc-telop');
    if (mid) {
      const meta = mediaMeta(mid); if (!meta) return;
      const kind = kindForType(meta.type);
      if (!tr || tr.kind !== kind) tr = kind === 'video' ? (trackById('V1') || firstTrack('video')) : firstTrack('audio');
      pushUndo();
      const c = makeMediaClip(meta, tr.id, t);
      P.clips.push(c); st.sel = new Set([c.id]);
      changed({ structure: true });
    } else if (did) {
      if (!tr || tr.kind !== 'telop') tr = firstTrack('telop');
      st.libDesign = did;
      pushUndo();
      const c = makeTelopClip(tr.id, t);
      P.clips.push(c); st.sel = new Set([c.id]);
      changed({ structure: true });
    } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
      const added = await importFiles(e.dataTransfer.files);
      if (added.length) {
        pushUndo();
        let tt = t;
        for (const meta of added) {
          const kind = kindForType(meta.type);
          let trk = tr && tr.kind === kind ? tr : (kind === 'video' ? (trackById('V1') || firstTrack('video')) : firstTrack('audio'));
          const c = makeMediaClip(meta, trk.id, tt);
          P.clips.push(c); tt = clipEnd(c);
        }
        changed({ structure: true });
      }
    }
  });

  /* =================================================================
     プロジェクトパネル（ビン）
     ================================================================= */
  const KIND_STYLE = { video: ['動画', '#4a6fa5'], audio: ['音声', '#3d8a5f'], image: ['画像', '#7a5ea8'] };
  function renderBin() {
    const bin = $('#bin');
    if (!P.media.length) {
      bin.innerHTML = `<div class="empty-bin"><b>素材をここにドラッグ＆ドロップ</b><br>動画（MP4 / MOV / WebM）・音声（MP3 / WAV / M4A）・画像（PNG / JPG）<br>SRT 字幕ファイルもそのまま読み込めます<br><br><button class="btn primary" data-cmd="import">ファイルを選ぶ</button></div>`;
      return;
    }
    bin.innerHTML = P.media.map((m) => {
      const rt = media.get(m.id);
      const [kl, kc] = KIND_STYLE[m.type] || ['?', '#555'];
      const th = rt && rt.thumb ? `style="background-image:url(${rt.thumb})"` : '';
      const icon = !rt ? '⚠' : m.type === 'audio' ? '♪' : '';
      const used = P.clips.filter((c) => c.mediaId === m.id).length;
      return `<div class="mcard${rt ? '' : ' unlinked'}" draggable="${rt ? 'true' : 'false'}" data-media="${m.id}" title="${escapeHtml(m.name)}${rt ? '' : '（未リンク：同じファイルを読み込むと復元）'}">
        <div class="th" ${th}>${icon}<span class="kind" style="background:${kc}">${kl}</span><span class="dur">${m.type === 'image' ? '画像' : shortTime(m.duration)}</span></div>
        <div class="nm">${used ? '● ' : ''}${escapeHtml(m.name)}</div>
        ${rt && rt.busy ? '<div class="busy">解析中…</div>' : ''}</div>`;
    }).join('');
  }
  $('#bin').addEventListener('dragstart', (e) => {
    const card = e.target.closest('.mcard'); if (!card) return;
    e.dataTransfer.setData('text/x-cc-media', card.dataset.media);
    e.dataTransfer.effectAllowed = 'copy';
  });
  $('#bin').addEventListener('dblclick', (e) => { const card = e.target.closest('.mcard'); if (card) appendMedia(card.dataset.media); });
  $('#bin').addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.mcard'); if (!card) return;
    e.preventDefault();
    const m = mediaMeta(card.dataset.media);
    if (m && confirm(`「${m.name}」をプロジェクトから削除しますか？`)) removeMedia(m.id);
  });
  $('#bin').addEventListener('click', (e) => {
    const card = e.target.closest('.mcard'); if (!card) return;
    $$('.mcard').forEach((x) => x.classList.toggle('sel', x === card));
  });

  /* ファイルのドロップ（パネル全体） */
  document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); $('#mon-drop').style.display = 'grid'; $('#bin').classList.add('over'); } });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { $('#mon-drop').style.display = 'none'; $('#bin').classList.remove('over'); } });
  document.addEventListener('drop', (e) => {
    $('#mon-drop').style.display = 'none'; $('#bin').classList.remove('over');
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault();
      importFiles(e.dataTransfer.files).then((added) => {
        // モニターにドロップ & タイムラインが空 → V1 に並べる
        if (added.length && e.target.closest('#monitor')) {
          pushUndo();
          for (const meta of added) {
            const kind = kindForType(meta.type);
            const tr = kind === 'video' ? (trackById('V1') || firstTrack('video')) : firstTrack('audio');
            P.clips.push(makeMediaClip(meta, tr.id, trackEnd(tr.id)));
          }
          changed({ structure: true });
        }
      });
    }
  });

  /* =================================================================
     テロップライブラリ
     ================================================================= */
  const libGrid = $('#lib-grid');
  let libObserver = null;
  const thumbQueue = [];
  let thumbBusy = false;
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.getContext('2d', { willReadFrequently: true });
  function setupLib() {
    const packs = {};
    for (const d of DESIGNS) packs[d.pack || 'tv-vol1'] = (packs[d.pack || 'tv-vol1'] || 0) + 1;
    const sel = $('#lib-pack');
    sel.innerHTML = '<option value="">すべてのパック（' + DESIGNS.length + '）</option>' +
      Object.keys(packs).map((k) => `<option value="${k}">${escapeHtml((PACKS[k] && PACKS[k].short) || k)}（${packs[k]}）</option>`).join('');
    sel.addEventListener('change', () => { st.libPack = sel.value; renderLib(); });
    $('#lib-q').addEventListener('input', (e) => { st.libQ = e.target.value.trim(); renderLib(); });
    libObserver = new IntersectionObserver((ents) => {
      for (const en of ents) if (en.isIntersecting) { libObserver.unobserve(en.target); thumbQueue.push(en.target); }
      pumpThumbs();
    }, { root: libGrid, rootMargin: '200px' });
    libGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.dcard'); if (!card) return;
      st.libDesign = card.dataset.design; st.libVariant = 0;
      $$('.dcard', libGrid).forEach((x) => x.classList.toggle('sel', x === card));
      renderVariants();
    });
    libGrid.addEventListener('dblclick', (e) => { const card = e.target.closest('.dcard'); if (card) { st.libDesign = card.dataset.design; cmd.addTelop(); } });
    libGrid.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.dcard'); if (!card) return;
      e.dataTransfer.setData('text/x-cc-telop', card.dataset.design); e.dataTransfer.effectAllowed = 'copy';
    });
  }
  function renderLib() {
    const q = st.libQ.toLowerCase();
    const list = DESIGNS.filter((d) => (!st.libPack || d.pack === st.libPack) &&
      (!q || [d.name, d.category, d.sample, d.id, (PACKS[d.pack] || {}).short].join(' ').toLowerCase().includes(q)));
    libGrid.innerHTML = list.slice(0, 600).map((d) => `<div class="dcard${st.libDesign === d.id ? ' sel' : ''}" draggable="true" data-design="${d.id}" title="${escapeHtml(d.name)}（${escapeHtml(d.category || '')}）"><canvas width="360" height="150"></canvas><div class="nm">${escapeHtml(d.name)}</div></div>`).join('') || '<div class="note" style="padding:12px;color:var(--muted)">該当するデザインがありません</div>';
    thumbQueue.length = 0;
    $$('.dcard', libGrid).forEach((el) => libObserver.observe(el));
    renderVariants();
  }
  function pumpThumbs() {
    if (thumbBusy) return;
    const el = thumbQueue.shift(); if (!el) return;
    thumbBusy = true;
    const d = designById.get(el.dataset.design);
    const spec = R.resolve(d, 0);
    R.ensureFonts(spec, [d.sample || '', d.sampleSub || '']).then(() => {
      try {
        R.render(thumbCanvas, d, { width: 1920, height: 1080, variant: 0 });
        const b = R.contentBounds(thumbCanvas, 12) || { x: 0, y: 0, w: 1920, h: 1080 };
        const cv = el.querySelector('canvas'); const g = cv.getContext('2d');
        g.clearRect(0, 0, cv.width, cv.height);
        const k = Math.min(cv.width / b.w, cv.height / b.h) * 0.92;
        g.drawImage(thumbCanvas, b.x, b.y, b.w, b.h, (cv.width - b.w * k) / 2, (cv.height - b.h * k) / 2, b.w * k, b.h * k);
      } catch (e) { /* ignore */ }
      thumbBusy = false;
      setTimeout(pumpThumbs, 0);
    });
  }
  function renderVariants() {
    const box = $('#lib-variants');
    const d = st.libDesign && designById.get(st.libDesign);
    if (!d) { box.innerHTML = '<span class="unit">デザインを選ぶとカラーを選べます。ダブルクリックかドラッグで追加</span>'; return; }
    const vs = d.variants && d.variants.length ? d.variants : [{ name: '標準' }];
    box.innerHTML = vs.map((v, i) => `<button class="chip${i === st.libVariant ? ' on' : ''}" data-v="${i}">${escapeHtml(v.name || '色' + (i + 1))}</button>`).join('');
  }
  $('#lib-variants').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; st.libVariant = +b.dataset.v; renderVariants(); });

  /* =================================================================
     インスペクター
     ================================================================= */
  const insp = $('#insp');
  function volToDb(v) { if (v <= 0.0001) return '-∞'; const db = 20 * Math.log10(v); return (db > 0 ? '+' : '') + db.toFixed(1); }

  function field(label, html) { return `<div class="field"><label>${label}</label><div class="ctl">${html}</div></div>`; }
  function scrub(prop, val, opts) {
    const o = Object.assign({ step: 1, min: -Infinity, max: Infinity, unit: '', dec: 0 }, opts || {});
    return `<span class="scrub" data-prop="${prop}" data-step="${o.step}" data-min="${o.min}" data-max="${o.max}" data-dec="${o.dec}">${(+val).toFixed(o.dec)}</span><span class="unit">${o.unit}</span>`;
  }

  function renderInspector() {
    const sel = P.clips.filter((c) => st.sel.has(c.id));
    if (!sel.length) { insp.innerHTML = projectInspector(); bindInspector(null); return; }
    if (sel.length > 1) {
      insp.innerHTML = `<div class="sec"><h4>${sel.length} 個のクリップを選択中</h4><div class="in">
        ${sel.some((c) => c.type !== 'telop' && c.type !== 'image') ? field('音量', scrub('volumeDb', 0, { step: 0.5, min: -60, max: 12, unit: 'dB 変化', dec: 1 })) : ''}
        <div class="btnrow"><button class="btn" data-cmd="delete">削除</button><button class="btn" data-cmd="rippleDelete">リップル削除</button></div>
        <div class="btnrow"><button class="btn" data-cmd="duplicate">複製</button><button class="btn" data-cmd="silence">無音カット</button></div>
      </div></div>`;
      bindInspector(sel);
      return;
    }
    const c = sel[0];
    const m = mediaMeta(c.mediaId);
    const TL = { video: ['ビデオクリップ', 'var(--c-video)'], image: ['画像クリップ', 'var(--c-image)'], audio: ['オーディオクリップ', 'var(--c-audio)'], telop: ['テロップ', 'var(--c-telop)'] }[c.type];
    let h = `<div class="sec"><h4><span class="sw" style="background:${TL[1]}"></span>${TL[0]}</h4><div class="in">
      ${c.type !== 'telop' ? `<div class="note" style="word-break:break-all">${escapeHtml(m ? m.name : '素材なし')}${m && m.width ? ` ・ ${m.width}×${m.height}` : ''}</div>` : ''}
      ${field('開始', `<span class="unit" style="color:var(--ink2)">${tc(c.start)}</span>`)}
      ${field('長さ', scrub('dur', c.dur, { step: 1 / fps(), min: MIN_DUR, max: maxSourceDur(c) - (c.in || 0), unit: '秒', dec: 2 }))}
      ${c.type === 'video' || c.type === 'audio' ? field('素材の開始', `<span class="unit" style="color:var(--ink2)">${tc(c.in || 0)}</span>`) : ''}
    </div></div>`;

    if (c.type === 'telop') {
      const d = designById.get(c.designId);
      const vs = d && d.variants && d.variants.length ? d.variants : [{ name: '標準' }];
      h += `<div class="sec"><h4>テキスト</h4><div class="in">
        <textarea id="t-text" rows="2" placeholder="テロップの文字（改行で2行）">${escapeHtml(c.text || '')}</textarea>
        ${d && d.sub ? `<input type="text" id="t-sub" placeholder="サブテキスト（肩書き・英字など）" value="${escapeHtml(c.sub || '')}">` : ''}
        <div class="note">デザイン：<b style="color:var(--ink)">${escapeHtml(d ? d.name : '不明')}</b>${d ? `（${escapeHtml((PACKS[d.pack] || {}).short || '')}）` : ''}</div>
        <div class="chips">${vs.map((v, i) => `<button class="chip${i === (c.variant || 0) ? ' on' : ''}" data-tv="${i}">${escapeHtml(v.name || '色' + (i + 1))}</button>`).join('')}</div>
        <div class="note">左の「テロップ」タブでデザインを選び「選択に適用」で入れ替えできます。</div>
      </div></div>`;
      h += `<div class="sec"><h4>アニメーション</h4><div class="in">
        ${field('登場', `<select id="t-anim">${[['none', 'なし'], ['pop', 'ポップ'], ['slideUp', '下からスライド'], ['slideLeft', '右からスライド'], ['wipe', 'ワイプ'], ['type', 'タイプライター']].map(([v, l]) => `<option value="${v}"${(c.anim || 'none') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${field('フェードイン', scrub('fadeIn', c.fadeIn || 0, { step: 0.05, min: 0, max: 5, unit: '秒', dec: 2 }))}
        ${field('フェードアウト', scrub('fadeOut', c.fadeOut || 0, { step: 0.05, min: 0, max: 5, unit: '秒', dec: 2 }))}
      </div></div>`;
    }
    if (c.type !== 'audio') {
      h += `<div class="sec"><h4>モーション</h4><div class="in">
        ${field('位置 X', scrub('x', c.x || 0, { step: 1, unit: 'px' }))}
        ${field('位置 Y', scrub('y', c.y || 0, { step: 1, unit: 'px' }))}
        ${field('スケール', scrub('scale', c.scale || 100, { step: 1, min: 5, max: 800, unit: '%' }))}
        ${field('不透明度', scrub('opacity', c.opacity == null ? 100 : c.opacity, { step: 1, min: 0, max: 100, unit: '%' }))}
        ${c.type !== 'telop' ? field('フィット', `<select id="c-fit"><option value="contain"${c.fit === 'contain' ? ' selected' : ''}>全体を表示（余白あり）</option><option value="cover"${c.fit === 'cover' ? ' selected' : ''}>画面を埋める（はみ出しカット）</option><option value="stretch"${c.fit === 'stretch' ? ' selected' : ''}>引き伸ばす</option></select>`) : ''}
        <div class="btnrow"><button class="btn sm" id="c-reset">モーションをリセット</button></div>
        <div class="note">プログラムモニター上でドラッグして移動、四隅をドラッグで拡大縮小。Shift で水平・垂直に固定。</div>
      </div></div>`;
    }
    if (c.type !== 'telop') {
      h += `<div class="sec"><h4>${c.type === 'image' ? 'フェード' : '音声とフェード'}</h4><div class="in">
        ${c.type !== 'image' ? field('音量', scrub('volumeDb', c.volume <= 0.0001 ? -60 : 20 * Math.log10(c.volume == null ? 1 : c.volume), { step: 0.5, min: -60, max: 12, unit: 'dB', dec: 1 })) : ''}
        ${field('フェードイン', scrub('fadeIn', c.fadeIn || 0, { step: 0.05, min: 0, max: 10, unit: '秒', dec: 2 }))}
        ${field('フェードアウト', scrub('fadeOut', c.fadeOut || 0, { step: 0.05, min: 0, max: 10, unit: '秒', dec: 2 }))}
        ${c.type === 'audio' ? '<div class="note">BGM は −18〜−24dB くらいが声の邪魔をしにくい目安です。</div>' : ''}
      </div></div>`;
    }
    h += `<div class="sec"><h4>操作</h4><div class="in">
      <div class="btnrow"><button class="btn" data-cmd="split">再生ヘッドで分割</button><button class="btn" data-cmd="duplicate">複製</button></div>
      ${(c.type === 'video' || c.type === 'audio') && m && m.hasAudio ? '<div class="btnrow"><button class="btn primary" data-cmd="silence">無音部分を自動カット…</button></div>' : ''}
      <div class="btnrow"><button class="btn danger" data-cmd="delete">削除</button><button class="btn danger" data-cmd="rippleDelete">リップル削除</button></div>
    </div></div>`;
    insp.innerHTML = h;
    bindInspector(sel);
  }

  function projectInspector() {
    const d = duration();
    const counts = { video: 0, image: 0, audio: 0, telop: 0 };
    for (const c of P.clips) counts[c.type]++;
    return `<div class="sec"><h4>プロジェクト</h4><div class="in">
      ${field('画面サイズ', `<select id="p-aspect">${Object.entries(ASPECTS).map(([k, a]) => `<option value="${k}"${P.aspect === k ? ' selected' : ''}>${a.label}（${a.w}×${a.h}）</option>`).join('')}</select>`)}
      ${field('フレームレート', `<select id="p-fps">${[24, 25, 30, 60].map((f) => `<option value="${f}"${P.fps === f ? ' selected' : ''}>${f} fps</option>`).join('')}</select>`)}
      ${field('尺', `<span class="unit" style="color:var(--ink2)">${tc(d)}</span>`)}
      ${field('クリップ', `<span class="unit" style="color:var(--ink2)">動画 ${counts.video} ・ 画像 ${counts.image} ・ 音声 ${counts.audio} ・ テロップ ${counts.telop}</span>`)}
    </div></div>
    <div class="sec"><h4>はじめかた</h4><div class="in note" style="gap:6px">
      <div>① 左の「プロジェクト」に動画・音声・画像をドラッグ＆ドロップ</div>
      <div>② 素材をダブルクリック（またはタイムラインへドラッグ）で配置</div>
      <div>③ <kbd>C</kbd> レーザーでカット、<kbd>Ctrl</kbd>+<kbd>K</kbd> で再生ヘッド位置を分割</div>
      <div>④ 「無音カット」で間を自動で詰める</div>
      <div>⑤ 「テロップ」タブからデザインをドラッグ、文字を入力</div>
      <div>⑥ 右上の「書き出し」で MP4 を保存</div>
    </div></div>
    <div class="sec"><h4>よく使うショートカット</h4><div class="in">${shortcutsHtml(true)}</div></div>`;
  }

  function shortcutsHtml(short) {
    const list = [
      ['Space', '再生／停止'], ['J K L', '逆再生／停止／再生（連打で倍速）'], ['← →', '1フレーム移動（Shift で5フレーム）'], ['↑ ↓', '前／次の編集点へ'],
      ['Ctrl+K', '再生ヘッドで分割'], ['V / C / B', '選択／レーザー／リップルツール'], ['Delete', '削除'], ['Shift+Delete', 'リップル削除'],
      ['Ctrl+Z', '取り消し'], ['T', 'テロップ追加'], ['= / -', 'ズーム'], ['\\', '全体表示'],
    ];
    const more = [['S', 'スナップ切替'], ['Ctrl+C / V', 'コピー／再生ヘッドに貼り付け'], ['Ctrl+D', '複製'], ['Ctrl+Shift+X', '無音カット'], ['Ctrl+S', 'プロジェクト保存'], ['Ctrl+M', '書き出し'], ['Home / End', '先頭／末尾'], ["'", 'セーフエリア'], ['Ctrl+ホイール', 'タイムラインのズーム']];
    return `<div class="keys">${(short ? list : list.concat(more)).map(([k, v]) => `<span>${k.split(' ').map((x) => x === '/' ? '/' : `<kbd>${x}</kbd>`).join(' ')}</span><span>${v}</span>`).join('')}</div>`;
  }

  function setProp(c, prop, v) {
    if (prop === 'volumeDb') { c.volume = v <= -60 ? 0 : Math.pow(10, v / 20); return; }
    if (prop === 'dur') { c.dur = snapFrame(Math.max(MIN_DUR, v)); return; }
    c[prop] = v;
  }

  function bindInspector(sel) {
    // プロジェクト設定
    const asp = $('#p-aspect', insp);
    if (asp) asp.addEventListener('change', () => {
      pushUndo();
      const a = ASPECTS[asp.value]; P.aspect = asp.value; P.width = a.w; P.height = a.h;
      telopCache.clear(); layoutMonitor(); changed({ props: true });
    });
    const fpsSel = $('#p-fps', insp);
    if (fpsSel) fpsSel.addEventListener('change', () => { pushUndo(); P.fps = +fpsSel.value; changed({ structure: true }); });
    if (!sel) return;
    const c = sel[0];

    // スクラブ可能な数値
    $$('.scrub', insp).forEach((el) => {
      const prop = el.dataset.prop, step = +el.dataset.step, min = +el.dataset.min, max = +el.dataset.max, dec = +el.dataset.dec;
      const apply = (v, key) => {
        v = clamp(v, min, max);
        pushUndo(key);
        if (sel.length > 1 && prop === 'volumeDb') {
          for (const x of sel) if (x.type !== 'telop' && x.type !== 'image') { const cur = x.volume <= 0.0001 ? -60 : 20 * Math.log10(x.volume == null ? 1 : x.volume); setProp(x, 'volumeDb', clamp(cur + (v - (+el.dataset.base || 0)), -60, 12)); }
          el.dataset.base = v;
        } else setProp(c, prop, v);
        el.textContent = (+v).toFixed(dec);
        if (prop === 'scale' && c.type === 'telop') telopCache.delete(c.id);
        changed({ props: true, light: true });
      };
      el.addEventListener('pointerdown', (e) => {
        const x0 = e.clientX, v0 = +el.textContent;
        let movedD = false;
        el.setPointerCapture(e.pointerId);
        const key = 'scrub-' + prop + '-' + Date.now();
        el.onpointermove = (ev) => {
          const dx = ev.clientX - x0;
          if (!movedD && Math.abs(dx) < 3) return;
          movedD = true;
          const mul = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
          apply(v0 + Math.round(dx / 2) * step * mul, key);
        };
        el.onpointerup = () => {
          el.onpointermove = null; el.onpointerup = null;
          if (!movedD) {
            // クリックで直接入力
            const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'scrub-in'; inp.value = el.textContent;
            el.replaceWith(inp); inp.focus(); inp.select();
            const done = (ok) => {
              if (ok) { const v = parseFloat(inp.value); if (isFinite(v)) apply(v, 'type-' + prop + Date.now()); }
              inp.replaceWith(el); renderTimeline();
            };
            inp.addEventListener('keydown', (ke) => { ke.stopPropagation(); if (ke.key === 'Enter') done(true); if (ke.key === 'Escape') done(false); });
            inp.addEventListener('blur', () => done(true), { once: true });
          } else renderTimeline();
        };
      });
    });

    const txt = $('#t-text', insp);
    if (txt) {
      txt.addEventListener('input', () => { pushUndo('text-' + c.id); c.text = txt.value; changed({ props: true, light: true }); });
      txt.addEventListener('keydown', (e) => { if (e.key === 'Escape') txt.blur(); else if (!((e.ctrlKey || e.metaKey) && /^[sSmM]$/.test(e.key))) e.stopPropagation(); });
    }
    const sub = $('#t-sub', insp);
    if (sub) { sub.addEventListener('input', () => { pushUndo('sub-' + c.id); c.sub = sub.value; changed({ props: true, light: true }); }); sub.addEventListener('keydown', (e) => { if (e.key === 'Escape') sub.blur(); else if (!((e.ctrlKey || e.metaKey) && /^[sSmM]$/.test(e.key))) e.stopPropagation(); }); }
    $$('[data-tv]', insp).forEach((b) => b.addEventListener('click', () => { pushUndo(); c.variant = +b.dataset.tv; changed({ props: true }); }));
    const anim = $('#t-anim', insp);
    if (anim) anim.addEventListener('change', () => { pushUndo(); c.anim = anim.value; changed({ props: true }); const s = c.start; seek(s); });
    const fit = $('#c-fit', insp);
    if (fit) fit.addEventListener('change', () => { pushUndo(); c.fit = fit.value; changed({ props: true }); });
    const rst = $('#c-reset', insp);
    if (rst) rst.addEventListener('click', () => { pushUndo(); c.x = 0; c.y = 0; c.scale = 100; c.opacity = 100; telopCache.delete(c.id); changed({ props: true }); });
  }
  function renderInspectorValues() {
    const sel = P.clips.filter((c) => st.sel.has(c.id));
    if (sel.length !== 1) return;
    const c = sel[0];
    $$('.scrub', insp).forEach((el) => {
      const p = el.dataset.prop, dec = +el.dataset.dec;
      if (p in c) el.textContent = (+c[p]).toFixed(dec);
    });
  }

  /* =================================================================
     変更通知
     ================================================================= */
  function changed(what) {
    what = what || {};
    if (what.structure || what.selection) { renderTimeline(); renderInspector(); }
    else if (what.props) { if (!what.light) renderInspector(); renderTimeline(); }
    if (what.structure) renderBin();
    if (!st.playing) syncMedia(st.time, false);
    requestDraw();
    if (what.structure || what.props) scheduleSave();
    $('#projname').value = P.name;
  }

  /* =================================================================
     無音カット
     ================================================================= */
  async function silenceDialog() {
    let targets = P.clips.filter((c) => st.sel.has(c.id) && (c.type === 'video' || c.type === 'audio') && (mediaMeta(c.mediaId) || {}).hasAudio);
    if (!targets.length) {
      const cands = P.clips.filter((c) => (c.type === 'video' || c.type === 'audio') && (mediaMeta(c.mediaId) || {}).hasAudio);
      const v1 = cands.filter((c) => c.track === 'V1');
      targets = v1.length ? v1 : cands;
    }
    if (!targets.length) return toast('音声のある動画・音声クリップがありません');
    const bufs = new Map();
    const m = openModal('無音部分を自動カット', `
      <p>声が入っていない「間」を見つけて、自動で切り取って詰めます。対象：<b>${targets.length} クリップ</b>（選択がなければ V1 全体）</p>
      ${field('しきい値', '<input type="range" id="s-th" min="-60" max="-20" step="1" value="-40"><span class="unit" id="s-thv" style="width:52px;text-align:right">-40dB</span>')}
      ${field('最短の無音', '<input type="range" id="s-min" min="0.2" max="2" step="0.05" value="0.5"><span class="unit" id="s-minv" style="width:52px;text-align:right">0.50秒</span>')}
      ${field('前後の余白', '<input type="range" id="s-pad" min="0" max="0.4" step="0.01" value="0.10"><span class="unit" id="s-padv" style="width:52px;text-align:right">0.10秒</span>')}
      <label class="field" style="gap:6px"><input type="checkbox" id="s-ripple" checked> 後ろのクリップ（テロップ・BGM など）も一緒に詰める</label>
      <canvas id="sil-graph" width="960" height="140"></canvas>
      <p class="big" id="s-sum">解析中…</p>
      <p class="note" style="font-size:11px;color:var(--muted)">緑＝残す部分、赤＝カットされる部分。しきい値を上げるほど小さな音もカットされます。</p>
    `, [['キャンセル', null], ['カットを実行', 'go', true]]);
    for (const c of targets) { const b = await getBuffer(c.mediaId); if (b) bufs.set(c.id, b); }
    const graph = $('#sil-graph', m.el), gctx = graph.getContext('2d');
    let result = null;
    const run = () => {
      const th = +$('#s-th', m.el).value, mn = +$('#s-min', m.el).value, pad = +$('#s-pad', m.el).value;
      $('#s-thv', m.el).textContent = th + 'dB'; $('#s-minv', m.el).textContent = mn.toFixed(2) + '秒'; $('#s-padv', m.el).textContent = pad.toFixed(2) + '秒';
      result = targets.map((c) => ({ c, keeps: bufs.has(c.id) ? detectKeeps(bufs.get(c.id), c.in || 0, c.dur, th, mn, pad) : [[0, c.dur]] }));
      let removed = 0, cuts = 0;
      for (const r of result) { const k = r.keeps.reduce((s, [a, b]) => s + b - a, 0); removed += r.c.dur - k; cuts += Math.max(0, r.keeps.length - 1) + (r.keeps.length && r.keeps[0][0] > 0.01 ? 1 : 0) + (r.keeps.length && r.c.dur - r.keeps[r.keeps.length - 1][1] > 0.01 ? 1 : 0); }
      const total = targets.reduce((s, c) => s + c.dur, 0);
      $('#s-sum', m.el).innerHTML = `${cuts} 箇所・<b>${removed.toFixed(1)} 秒</b> をカット（${shortTime(total)} → ${shortTime(total - removed)}）`;
      // グラフ
      const W = graph.width, H = graph.height;
      gctx.clearRect(0, 0, W, H);
      let x = 0;
      for (const r of result) {
        const w = r.c.dur / total * W;
        const b = bufs.get(r.c.id);
        gctx.fillStyle = 'rgba(229,72,77,.35)'; gctx.fillRect(x, 0, w, H);
        gctx.fillStyle = 'rgba(62,207,142,.35)';
        for (const [a, bb] of r.keeps) gctx.fillRect(x + a / r.c.dur * w, 0, (bb - a) / r.c.dur * w, H);
        if (b) {
          const ch = b.getChannelData(0), sr = b.sampleRate;
          gctx.fillStyle = 'rgba(255,255,255,.75)';
          for (let px = 0; px < w; px++) {
            const s0 = Math.floor(((r.c.in || 0) + px / w * r.c.dur) * sr), s1 = Math.floor(((r.c.in || 0) + (px + 1) / w * r.c.dur) * sr);
            let mx = 0; for (let i = s0; i < s1 && i < ch.length; i += 8) mx = Math.max(mx, Math.abs(ch[i]));
            const hh = mx * H * 0.9; gctx.fillRect(x + px, (H - hh) / 2, 1, Math.max(1, hh));
          }
          const ty = H / 2 * (1 - Math.pow(10, th / 20) * 0.9);
          gctx.fillStyle = 'rgba(255,216,77,.8)'; gctx.fillRect(x, ty, w, 1); gctx.fillRect(x, H - ty, w, 1);
        }
        x += w;
      }
    };
    ['#s-th', '#s-min', '#s-pad'].forEach((s) => $(s, m.el).addEventListener('input', run));
    run();
    const r = await m.result;
    if (r !== 'go' || !result) return;
    applySilenceCut(result, $('#s-ripple', m.el).checked);
  }

  /** 残す区間（クリップ内のローカル秒）を返す */
  function detectKeeps(buf, srcIn, dur, thDb, minSil, pad) {
    const sr = buf.sampleRate, win = Math.round(sr * 0.01);
    const chs = []; for (let i = 0; i < Math.min(2, buf.numberOfChannels); i++) chs.push(buf.getChannelData(i));
    const s0 = Math.floor(srcIn * sr), n = Math.floor(dur * 100);
    const th = Math.pow(10, thDb / 20);
    const silent = new Uint8Array(n);
    for (let w = 0; w < n; w++) {
      let sum = 0, cnt = 0;
      const a = s0 + w * win, b = Math.min(a + win, buf.length);
      for (const ch of chs) for (let i = a; i < b; i++) { sum += ch[i] * ch[i]; cnt++; }
      silent[w] = cnt ? (Math.sqrt(sum / cnt) < th ? 1 : 0) : 1;
    }
    const cuts = [];
    let i = 0;
    while (i < n) {
      if (!silent[i]) { i++; continue; }
      let j = i; while (j < n && silent[j]) j++;
      const a = i / 100, b = j / 100;
      const isHead = i === 0, isTail = j >= n;
      if (b - a >= minSil || ((isHead || isTail) && b - a >= Math.min(minSil, 0.3))) {
        const ca = isHead ? 0 : a + pad, cb = isTail ? dur : b - pad;
        if (cb - ca > 0.04) cuts.push([ca, cb]);
      }
      i = j;
    }
    const keeps = [];
    let t = 0;
    for (const [a, b] of cuts) { if (a - t > 0.05) keeps.push([t, a]); t = b; }
    if (dur - t > 0.05) keeps.push([t, dur]);
    if (!keeps.length) return [[0, dur]];
    return keeps.map(([a, b]) => [snapFrame(a), snapFrame(b)]).filter(([a, b]) => b - a >= 1 / fps());
  }

  function applySilenceCut(result, ripple) {
    pushUndo();
    // 後ろのクリップから処理すると時刻計算がずれない
    result.sort((a, b) => b.c.start - a.c.start);
    let totalRemoved = 0;
    const newSel = [];
    for (const { c, keeps } of result) {
      if (keeps.length === 1 && keeps[0][0] < 0.001 && Math.abs(keeps[0][1] - c.dur) < 0.001) { newSel.push(c.id); continue; }
      const origStart = c.start, origEnd = clipEnd(c);
      // 元の時刻 → 新しい時刻
      const mapT = (t) => {
        if (t <= origStart) return t;
        if (t >= origEnd) return t - (c.dur - keeps.reduce((s, [a, b]) => s + b - a, 0));
        const lt = t - origStart; let acc = 0;
        for (const [a, b] of keeps) { if (lt < a) return origStart + acc; if (lt <= b) return origStart + acc + (lt - a); acc += b - a; }
        return origStart + acc;
      };
      const parts = [];
      let pos = origStart;
      keeps.forEach(([a, b], idx) => {
        const n = clone(c); n.id = idx === 0 ? c.id : uid('c');
        n.start = snapFrame(pos); n.in = (c.in || 0) + a; n.dur = snapFrame(b - a);
        n.fadeIn = idx === 0 ? c.fadeIn : 0; n.fadeOut = idx === keeps.length - 1 ? c.fadeOut : 0;
        pos += n.dur; parts.push(n);
      });
      const removed = c.dur - parts.reduce((s, x) => s + x.dur, 0);
      totalRemoved += removed;
      P.clips = P.clips.filter((x) => x.id !== c.id);
      if (ripple) {
        const partIds = new Set(result.map((r) => r.c.id));
        for (const x of P.clips) {
          if (partIds.has(x.id)) continue;
          if (x.track === c.track && x.start >= origEnd - EPS) { x.start = snapFrame(x.start - removed); continue; }
          if (clipEnd(x) <= origStart + EPS) continue;
          const ns = mapT(x.start), ne = mapT(clipEnd(x));
          if (x.type === 'video' || x.type === 'audio') {
            // 素材クリップは位置だけずらす（中身は切らない）
            x.start = snapFrame(ns);
          } else { x.start = snapFrame(ns); x.dur = snapFrame(Math.max(MIN_DUR, ne - ns)); }
        }
      }
      P.clips.push(...parts);
      newSel.push(...parts.map((p) => p.id));
    }
    st.sel = new Set(newSel);
    changed({ structure: true });
    toast(`無音カット完了：${totalRemoved.toFixed(1)} 秒を詰めました（Ctrl+Z で戻せます）`);
  }

  /* =================================================================
     SRT 読み込み
     ================================================================= */
  function parseSrt(text) {
    const out = [];
    const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').replace(/^WEBVTT[^\n]*\n/, '').split(/\n\s*\n/);
    const ts = (s) => { const m = s.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/); if (!m) return null; return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000; };
    for (const b of blocks) {
      const lines = b.split('\n').filter((l) => l.trim() !== '');
      const li = lines.findIndex((l) => l.includes('-->'));
      if (li < 0) continue;
      const [a, z] = lines[li].split('-->');
      const s = ts(a), e = ts(z);
      if (s == null || e == null || e <= s) continue;
      const txt = lines.slice(li + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (txt) out.push({ s, e, txt });
    }
    return out;
  }
  async function importSrtFile(file) {
    const text = await file.text();
    const items = parseSrt(text);
    if (!items.length) return toast(`${file.name}：字幕が見つかりませんでした`, true);
    const d = defaultDesign();
    let srtDefault = '';
    const m = openModal('SRT 字幕をテロップとして読み込み', `
      <p><b>${escapeHtml(file.name)}</b> から <b>${items.length} 件</b>の字幕が見つかりました。</p>
      ${field('デザイン', `<span>${escapeHtml(d ? d.name : '')}</span>`)}
      <p class="note" style="font-size:11px;color:var(--muted)">デザインは左の「テロップ」タブで選んだものが使われます。あとからまとめて「選択に適用」で変更もできます。</p>
      ${field('開始位置', '<select id="srt-at"><option value="0">タイムラインの先頭（00:00）から</option><option value="ph">再生ヘッドの位置から</option></select>')}
      ${field('置き場所', `<select id="srt-tr">${P.tracks.filter((t) => t.kind === 'telop').map((t) => `<option value="${t.id}"${!srtDefault && !P.clips.some((c) => c.track === t.id) ? (srtDefault = ' selected') : ''}>${t.id}${P.clips.some((c) => c.track === t.id) ? '（使用中）' : '（空き）'}</option>`).join('')}<option value="new"${srtDefault ? '' : ' selected'}>新しいテロップトラック</option></select>`)}
    `, [['キャンセル', null], ['読み込む', 'go', true]]);
    const r = await m.result;
    if (r !== 'go') return;
    const off = $('#srt-at', m.el).value === 'ph' ? st.time : 0;
    let tid = $('#srt-tr', m.el).value;
    pushUndo();
    if (tid === 'new') { const before = new Set(P.tracks.map((t) => t.id)); addTrack('telop'); undoStack.pop(); tid = P.tracks.find((t) => !before.has(t.id)).id; }
    const news = items.map((it) => makeTelopClip(tid, off + it.s, it.txt, it.e - it.s));
    P.clips.push(...news);
    st.sel = new Set(news.map((c) => c.id));
    changed({ structure: true });
    toast(`${news.length} 件の字幕をテロップにしました`);
  }

  /* =================================================================
     モーダル
     ================================================================= */
  function openModal(title, body, buttons, opts) {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" style="${opts && opts.width ? 'width:min(' + opts.width + 'px,94vw)' : ''}"><h3>${title}</h3><div class="mb">${body}</div><div class="mf">${(buttons || []).map(([l, v, pri], i) => `<button class="btn${pri ? ' primary' : ''}" data-mb="${i}">${l}</button>`).join('')}</div></div>`;
    document.body.appendChild(bg);
    let resolve;
    const result = new Promise((r) => { resolve = r; });
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', esc, true); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape' && !(opts && opts.locked)) { e.stopPropagation(); close(null); } if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && buttons && buttons.length) { const pri = buttons.findIndex((b) => b[2]); if (pri >= 0 && !(opts && opts.locked)) { e.preventDefault(); close(buttons[pri][1]); } } };
    document.addEventListener('keydown', esc, true);
    $$('[data-mb]', bg).forEach((b) => b.addEventListener('click', () => { const v = buttons[+b.dataset.mb][1]; if (typeof v === 'function') v(); else close(v); }));
    bg.addEventListener('pointerdown', (e) => { if (e.target === bg && !(opts && opts.locked)) close(null); });
    return { el: bg, result, close };
  }

  /* =================================================================
     書き出し（WebCodecs → MP4）
     ================================================================= */
  async function pickVideoCodec(w, h, bitrate, fr) {
    if (!window.VideoEncoder) return null;
    const cands = [
      ['avc1.640034', 'avc'], ['avc1.640033', 'avc'], ['avc1.640028', 'avc'], ['avc1.4d0034', 'avc'], ['avc1.4d0028', 'avc'], ['avc1.42003e', 'avc'], ['avc1.42001f', 'avc'],
      ['vp09.00.40.08', 'vp9'], ['av01.0.08M.08', 'av1'],
    ];
    for (const [codec, kind] of cands) {
      const cfg = { codec, width: w, height: h, bitrate, framerate: fr };
      if (kind === 'avc') cfg.avc = { format: 'avc' };
      try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return { cfg, kind }; } catch (e) { /* next */ }
    }
    return null;
  }
  async function pickAudioCodec() {
    if (!window.AudioEncoder) return null;
    for (const [codec, kind] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
      try { const s = await AudioEncoder.isConfigSupported(cfg); if (s.supported) return { cfg, kind }; } catch (e) { /* next */ }
    }
    return null;
  }

  async function mixAudio(total, sr) {
    const items = P.clips.filter((c) => (c.type === 'video' || c.type === 'audio') && (mediaMeta(c.mediaId) || {}).hasAudio && !(trackById(c.track) || {}).muted && media.has(c.mediaId));
    if (!items.length) return null;
    const len = Math.max(1, Math.ceil(total * sr));
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oc = new OAC(2, len, sr);
    for (const c of items) {
      const buf = await getBuffer(c.mediaId); if (!buf) continue;
      const src = oc.createBufferSource(); src.buffer = buf;
      const g = oc.createGain();
      const v = c.volume == null ? 1 : c.volume;
      const s = c.start, e = clipEnd(c);
      if (c.fadeIn > 0) { g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(v, s + c.fadeIn); } else g.gain.setValueAtTime(v, s);
      if (c.fadeOut > 0) { g.gain.setValueAtTime(v, Math.max(s, e - c.fadeOut)); g.gain.linearRampToValueAtTime(0, e); }
      src.connect(g); g.connect(oc.destination);
      const off = Math.min(c.in || 0, buf.duration);
      src.start(s, off, Math.max(0, Math.min(c.dur, buf.duration - off)));
    }
    return oc.startRendering();
  }

  function seekEl(el, t) {
    return new Promise((res) => {
      if (el.readyState >= 2 && Math.abs(el.currentTime - t) < 0.0005) return res();
      let done = false;
      const fin = () => { if (done) return; done = true; el.removeEventListener('seeked', onSeek); clearTimeout(to); res(); };
      const onSeek = () => {
        if (el.requestVideoFrameCallback) { let ok = false; el.requestVideoFrameCallback(() => { ok = true; fin(); }); setTimeout(() => { if (!ok) fin(); }, 60); }
        else fin();
      };
      el.addEventListener('seeked', onSeek);
      const to = setTimeout(fin, 5000);
      el.currentTime = t;
    });
  }
  function loadEl(url) {
    return new Promise((res) => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
      const ok = () => { v.removeEventListener('loadeddata', ok); res(v); };
      v.addEventListener('loadeddata', ok);
      v.addEventListener('error', () => res(v));
      setTimeout(() => res(v), 8000);
    });
  }

  async function exportDialog() {
    pause();
    const total = duration();
    if (total <= 0) return toast('タイムラインが空です', true);
    const missing = P.clips.filter((c) => c.type !== 'telop' && !media.has(c.mediaId));
    if (missing.length && !confirm(`${missing.length} 個のクリップの素材が見つかりません（未リンク）。このまま書き出しますか？`)) return;
    const hasWC = !!(window.VideoEncoder && window.VideoFrame && window.Mp4Muxer);
    const name = (P.name || 'chain-cut').replace(/[\\/:*?"<>|]/g, '_');
    const m = openModal('MP4 に書き出し', `
      ${hasWC ? '' : '<p style="color:var(--warn)">このブラウザは高速書き出し（WebCodecs）に対応していません。Chrome または Edge の最新版でお使いください。</p>'}
      ${field('ファイル名', `<input type="text" id="x-name" value="${escapeHtml(name)}">`)}
      ${field('解像度', `<select id="x-res"><option value="1">${P.width}×${P.height}（フル）</option><option value="0.6667">${Math.round(P.width * 2 / 3 / 2) * 2}×${Math.round(P.height * 2 / 3 / 2) * 2}（軽量）</option><option value="0.5">${P.width / 2}×${P.height / 2}（確認用）</option></select>`)}
      ${field('画質', '<select id="x-q"><option value="20">高画質（20 Mbps）</option><option value="12" selected>標準（12 Mbps）</option><option value="6">軽量（6 Mbps）</option></select>')}
      ${field('範囲', `<select id="x-range"><option value="all">全体（${tc(total)}）</option>${P.clips.some((c) => st.sel.has(c.id)) ? '<option value="sel">選択したクリップの範囲</option>' : ''}</select>`)}
      <p class="note" style="font-size:11px;color:var(--muted)">H.264 / AAC の MP4 を作ります。書き出しはブラウザの中だけで行われ、動画がどこかに送信されることはありません。</p>
    `, [['キャンセル', null], ['書き出し開始', 'go', true]]);
    const r = await m.result;
    if (r !== 'go') return;
    if (!hasWC) return toast('このブラウザでは書き出しできません。Chrome / Edge をお使いください', true);
    const opts = {
      name: ($('#x-name', m.el).value || name).replace(/[\\/:*?"<>|]/g, '_'),
      k: +$('#x-res', m.el).value, mbps: +$('#x-q', m.el).value, range: $('#x-range', m.el).value,
    };
    await runExport(opts);
  }

  let exportAbort = false;
  async function runExport(opts) {
    let t0 = 0, t1 = duration();
    if (opts.range === 'sel') {
      const cs = P.clips.filter((c) => st.sel.has(c.id));
      t0 = Math.min(...cs.map((c) => c.start)); t1 = Math.max(...cs.map(clipEnd));
    }
    const total = t1 - t0;
    const fr = fps();
    const W = Math.round(P.width * opts.k / 2) * 2, H = Math.round(P.height * opts.k / 2) * 2;
    exportAbort = false;
    const m = openModal('書き出し中…', `
      <p class="big" id="x-stage">準備しています…</p>
      <div class="prog"><div id="x-bar"></div></div>
      <p id="x-info" style="font-variant-numeric:tabular-nums">—</p>
      <p class="note" style="font-size:11px;color:var(--muted)">このタブを開いたままお待ちください（別タブに切り替えると遅くなることがあります）。</p>
    `, [['中止', () => { exportAbort = true; }]], { locked: true });
    const setStage = (s) => { $('#x-stage', m.el).textContent = s; };
    const setProg = (p, info) => { $('#x-bar', m.el).style.width = (p * 100).toFixed(1) + '%'; if (info) $('#x-info', m.el).textContent = info; };
    const exPlayers = new Map();
    try {
      // フォント
      setStage('フォントを準備中…');
      const fontJobs = [];
      for (const c of P.clips) if (c.type === 'telop') { const d = designById.get(c.designId); if (d) { const p = ensureTelopFonts(d, c); if (p) fontJobs.push(p); } }
      await Promise.all(fontJobs);
      try { await document.fonts.ready; } catch (e) { /* ignore */ }
      telopCache.clear();

      const vc = await pickVideoCodec(W, H, opts.mbps * 1e6, fr);
      if (!vc) throw new Error('このブラウザは動画エンコードに対応していません');
      setStage('音声をミックス中…');
      const sr = 48000;
      let mixed = null;
      try { mixed = await mixAudio(t1, sr); } catch (e) { console.warn(e); }
      const ac = mixed ? await pickAudioCodec() : null;

      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: vc.kind, width: W, height: H, frameRate: fr },
        audio: ac ? { codec: ac.kind, numberOfChannels: 2, sampleRate: sr } : undefined,
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
      let encErr = null;
      const venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => { encErr = e; } });
      venc.configure(vc.cfg);

      // 音声
      if (ac && mixed) {
        setStage('音声をエンコード中…');
        const aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: (e) => { encErr = e; } });
        aenc.configure(ac.cfg);
        const s0 = Math.floor(t0 * sr), s1 = Math.min(mixed.length, Math.ceil(t1 * sr));
        const L = mixed.getChannelData(0), Rr = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : L;
        const CH = 1024 * 4;
        for (let i = s0; i < s1; i += CH) {
          const n = Math.min(CH, s1 - i);
          const data = new Float32Array(n * 2);
          data.set(L.subarray(i, i + n), 0); data.set(Rr.subarray(i, i + n), n);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i - s0) / sr * 1e6), data });
          aenc.encode(ad); ad.close();
          if (aenc.encodeQueueSize > 50) await new Promise((r) => setTimeout(r, 0));
        }
        await aenc.flush(); aenc.close();
      }

      // 映像
      setStage('映像をレンダリング中…');
      const cv = document.createElement('canvas'); cv.width = P.width; cv.height = P.height;
      const cx = cv.getContext('2d', { alpha: false });
      const out = (W === P.width && H === P.height) ? cv : Object.assign(document.createElement('canvas'), { width: W, height: H });
      const ox = out === cv ? null : out.getContext('2d', { alpha: false });
      const nFrames = Math.max(1, Math.round(total * fr));
      const tStart = performance.now();
      for (let f = 0; f < nFrames; f++) {
        if (exportAbort) throw new Error('中止しました');
        if (encErr) throw encErr;
        const t = t0 + f / fr + 0.0001;
        // 必要なプレイヤーを用意してシーク
        const jobs = [];
        for (const c of P.clips) {
          if (c.type !== 'video') continue;
          const tr = trackById(c.track); if (tr && tr.hidden) continue;
          if (isActive(c, t)) {
            let el = exPlayers.get(c.id);
            if (!el) { const rt = media.get(c.mediaId); if (!rt) continue; el = await loadEl(rt.url); exPlayers.set(c.id, el); }
            jobs.push(seekEl(el, Math.min((c.in || 0) + (t - c.start), (mediaMeta(c.mediaId).duration || 1e9) - 0.001)));
          } else if (exPlayers.has(c.id) && t > clipEnd(c)) {
            const el = exPlayers.get(c.id); el.removeAttribute('src'); el.load(); exPlayers.delete(c.id);
          }
        }
        await Promise.all(jobs);
        drawFrame(cx, t, { players: exPlayers });
        if (ox) { ox.imageSmoothingQuality = 'high'; ox.drawImage(cv, 0, 0, W, H); }
        const frame = new VideoFrame(out, { timestamp: Math.round(f / fr * 1e6), duration: Math.round(1e6 / fr) });
        venc.encode(frame, { keyFrame: f % (fr * 2) === 0 });
        frame.close();
        while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));
        if (f % 5 === 0 || f === nFrames - 1) {
          const el = (performance.now() - tStart) / 1000;
          const speed = (f + 1) / el;
          const eta = (nFrames - f - 1) / Math.max(speed, 0.01);
          setProg((f + 1) / nFrames, `${f + 1} / ${nFrames} フレーム ・ ${speed.toFixed(1)} fps ・ 残り約 ${eta < 60 ? Math.ceil(eta) + ' 秒' : Math.ceil(eta / 60) + ' 分'}`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      setStage('仕上げ中…');
      await venc.flush(); venc.close();
      if (encErr) throw encErr;
      muxer.finalize();
      const buf = muxer.target.buffer;
      const blob = new Blob([buf], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = opts.name + '.mp4';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      m.close();
      const secs = ((performance.now() - tStart) / 1000).toFixed(1);
      const codecNote = vc.kind === 'avc' ? 'H.264' : vc.kind.toUpperCase();
      openModal('書き出し完了', `<p class="big">${escapeHtml(opts.name)}.mp4（${(blob.size / 1048576).toFixed(1)} MB）</p>
        <p>${W}×${H} ・ ${fr}fps ・ ${codecNote}${ac ? ' / ' + (ac.kind === 'aac' ? 'AAC' : 'Opus') : ' / 音声なし'} ・ ${secs} 秒で書き出しました。ダウンロードフォルダを確認してください。</p>
        ${vc.kind !== 'avc' ? '<p style="color:var(--warn)">このブラウザでは H.264 が使えなかったため別の形式で書き出しました。Chrome / Edge（Windows・Mac）なら H.264 になります。</p>' : ''}
        <p><a href="${url}" download="${escapeHtml(opts.name)}.mp4" style="color:var(--accent2)">もう一度ダウンロード</a></p>`, [['閉じる', null, true]]);
      window.__lastExport = { size: blob.size, W, H, frames: nFrames, video: vc.kind, audio: ac && ac.kind, url };
    } catch (e) {
      console.error(e);
      m.close();
      window.__lastExport = { error: String(e && e.message || e) };
      if (!exportAbort) toast('書き出しに失敗しました：' + (e.message || e), true); else toast('書き出しを中止しました');
    } finally {
      for (const el of exPlayers.values()) { el.removeAttribute('src'); el.load(); }
      telopCache.clear();
      requestDraw();
    }
  }

  function saveSnapshot() {
    const c = document.createElement('canvas'); c.width = P.width; c.height = P.height;
    drawFrame(c.getContext('2d'), st.time);
    c.toBlob((b) => {
      downloadBlob(b, `${safeName(P.name || 'frame')}_${tc(st.time).replace(/:/g, '-')}.png`);
    }, 'image/png');
  }

  /* =================================================================
     プロジェクトファイル
     ================================================================= */
  function saveProjectFile() {
    const data = JSON.stringify(Object.assign({ app: 'chain-cut', savedAt: new Date().toISOString() }, P), null, 1);
    downloadBlob(new Blob([data], { type: 'application/json' }), safeName(P.name || 'project') + '.ccut.json');
    autosave();
    toast('プロジェクトを保存しました（素材は含みません。人に渡すときは「素材ごとパッケージ保存」）');
  }
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  const safeName = (n) => String(n).replace(/[\\/:*?"<>|]/g, '_');
  async function savePackage() {
    if (!window.JSZip) return toast('パッケージ保存の部品を読み込めませんでした（ネット接続を確認してください）', true);
    const used = P.media.filter((m) => media.has(m.id));
    const missing = P.media.length - used.length;
    const total = used.reduce((s, m) => s + (m.size || 0), 0);
    const m = openModal('素材ごとパッケージ保存', `
      <p>プロジェクトと素材ファイル（動画・音声・画像）を <b>1つの .zip</b> にまとめて保存します。このファイルを渡せば、相手も Chain Cut の「ファイル → プロジェクトを開く」でそのまま続きを編集できます。</p>
      <p class="big">素材 ${used.length} 個 ・ 約 ${(total / 1048576).toFixed(1)} MB</p>
      ${missing ? `<p style="color:var(--warn)">未リンクの素材が ${missing} 個あります（パッケージには入りません）。</p>` : ''}
      <p class="note" style="font-size:11px;color:var(--muted)">大きな動画は保存に時間がかかります。共有はギガファイル便・Google ドライブなどでどうぞ。</p>
    `, [['キャンセル', null], ['保存する', 'go', true]]);
    if (await m.result !== 'go') return;
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(Object.assign({ app: 'chain-cut', savedAt: new Date().toISOString() }, P), null, 1));
    zip.file('はじめにお読みください.txt', `このファイルは動画編集ソフト「Chain Cut」のプロジェクトです。\r\n\r\n開き方：\r\n1. Chrome か Edge で Chain Cut を開く\r\n2. メニュー「ファイル → プロジェクトを開く」でこの .zip を選ぶ（解凍は不要です）\r\n`);
    for (const mm of used) zip.file(`media/${mm.id}__${safeName(mm.name)}`, media.get(mm.id).blob);
    const prog = openModal('パッケージを作成中…', '<div class="prog"><div id="pk-bar"></div></div><p id="pk-info">0%</p>', [], { locked: true });
    try {
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, (md) => {
        const b = $('#pk-bar', prog.el); if (b) b.style.width = md.percent.toFixed(1) + '%';
        const i = $('#pk-info', prog.el); if (i) i.textContent = md.percent.toFixed(0) + '%';
      });
      downloadBlob(blob, safeName(P.name || 'project') + '.chaincut.zip');
      toast(`パッケージを保存しました（${(blob.size / 1048576).toFixed(1)} MB）`);
    } catch (e) {
      toast('パッケージを作れませんでした：' + (e.message || e), true);
    } finally { prog.close(); }
  }

  async function openProjectFile(file) {
    let o;
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4b; // 先頭が "PK" なら zip
    if (isZip) {
      if (!window.JSZip) return toast('パッケージを開く部品を読み込めませんでした', true);
      const prog = openModal('パッケージを開いています…', '<p id="pk-info">読み込み中…</p>', [], { locked: true });
      try {
        const zip = await JSZip.loadAsync(file);
        const pj = zip.file('project.json');
        if (!pj) throw new Error('Chain Cut のパッケージではありません');
        o = JSON.parse(await pj.async('string'));
        let n = 0;
        for (const mm of o.media || []) {
          const f = zip.file(`media/${mm.id}__${safeName(mm.name)}`);
          if (!f) continue;
          $('#pk-info', prog.el).textContent = `素材を取り出し中… ${++n} / ${o.media.length}`;
          const raw = await f.async('blob');
          const blob = new File([raw], mm.name, { type: mm.mime || '' });
          await idbPut('media', { id: mm.id, blob, thumb: null, peaks: null });
        }
      } catch (e) {
        prog.close();
        return toast('パッケージを開けませんでした：' + (e.message || e), true);
      }
      prog.close();
    } else {
      try { o = JSON.parse(await file.text()); } catch (e) { return toast('プロジェクトファイルを読めませんでした', true); }
    }
    if (!o || !Array.isArray(o.clips) || !Array.isArray(o.tracks)) return toast('Chain Cut のプロジェクトファイルではありません', true);
    pause();
    for (const id of Array.from(players.keys())) disposePlayer(id);
    delete o.app; delete o.savedAt;
    P = Object.assign(newProject(o.aspect, o.fps), o);
    for (const mm of P.media) if (mm.type === 'image') mm.duration = Infinity;
    media.clear(); telopCache.clear();
    await restoreMedia();
    undoStack.length = 0; redoStack.length = 0; st.sel.clear(); st.time = 0;
    layoutMonitor(); changed({ structure: true }); zoomFit();
    const miss = P.media.filter((mm) => !media.has(mm.id));
    if (miss.length) toast(`${miss.length} 個の素材が未リンクです。同じファイルを読み込むと自動で復元されます`, true);
    else toast('プロジェクトを開きました');
  }
  async function newProjectDialog() {
    let aspect = P.aspect, fpsV = P.fps;
    const m = openModal('新規プロジェクト', `
      <div class="aspects">${Object.entries(ASPECTS).map(([k, a]) => { const s = 54 / Math.max(a.w, a.h); return `<button data-as="${k}" class="${k === aspect ? 'on' : ''}"><div class="shape" style="width:${a.w * s}px;height:${a.h * s}px"></div><b>${a.label}</b><small>${a.sub}</small></button>`; }).join('')}</div>
      ${field('フレームレート', `<select id="n-fps">${[24, 25, 30, 60].map((f) => `<option${f === 30 ? ' selected' : ''}>${f}</option>`).join('')}</select>`)}
      ${field('名前', '<input type="text" id="n-name" value="無題のプロジェクト">')}
      <p class="note" style="font-size:11px;color:var(--muted)">今のプロジェクトは閉じられます。必要なら先に「ファイル → プロジェクトを保存」してください。読み込み済みの素材はブラウザに残ります。</p>
    `, [['キャンセル', null], ['作成', 'go', true]]);
    $$('[data-as]', m.el).forEach((b) => b.addEventListener('click', () => { aspect = b.dataset.as; $$('[data-as]', m.el).forEach((x) => x.classList.toggle('on', x === b)); }));
    const r = await m.result;
    if (r !== 'go') return;
    fpsV = +$('#n-fps', m.el).value;
    pause();
    for (const id of Array.from(players.keys())) disposePlayer(id);
    const keepMedia = P.media;
    P = newProject(aspect, fpsV);
    P.name = $('#n-name', m.el).value || '無題のプロジェクト';
    P.media = keepMedia; // 素材ビンは引き継ぐ（使い回しが多いため）
    undoStack.length = 0; redoStack.length = 0; st.sel.clear(); st.time = 0;
    telopCache.clear();
    layoutMonitor(); changed({ structure: true }); setZoom(60, 0);
  }

  /* =================================================================
     コマンド
     ================================================================= */
  const cmd = {
    new: newProjectDialog,
    open: () => $('#file-proj').click(),
    save: saveProjectFile,
    savePackage,
    import: () => $('#file-media').click(),
    importSrt: () => $('#file-srt').click(),
    export: exportDialog,
    snapshot: saveSnapshot,
    undo, redo,
    copy: copySel, paste, duplicate,
    delete: () => deleteSelected(false),
    rippleDelete: () => deleteSelected(true),
    selectAll: () => { st.sel = new Set(P.clips.map((c) => c.id)); changed({ selection: true }); },
    deselect: () => { st.sel.clear(); changed({ selection: true }); },
    split: splitAtPlayhead,
    silence: silenceDialog,
    closeGaps,
    addTelop: () => {
      const sel = P.clips.find((c) => st.sel.has(c.id) && c.type === 'telop');
      const tr = sel ? trackById(sel.track) : firstTrack('telop');
      if (!tr) return;
      pushUndo();
      let start = st.time;
      // 同じトラックの再生ヘッド位置にテロップがあれば、その後ろへ
      const over = P.clips.find((c) => c.track === tr.id && isActive(c, start));
      if (over) start = clipEnd(over);
      const c = makeTelopClip(tr.id, start);
      P.clips.push(c); st.sel = new Set([c.id]);
      changed({ structure: true });
      setTimeout(() => { const ta = $('#t-text'); if (ta) { ta.focus(); ta.select(); } }, 30);
    },
    applyDesign: () => {
      const cs = P.clips.filter((c) => st.sel.has(c.id) && c.type === 'telop');
      if (!st.libDesign) return toast('左の「テロップ」タブでデザインを選んでください');
      if (!cs.length) return toast('タイムラインでテロップを選択してください（複数可）');
      pushUndo();
      for (const c of cs) { c.designId = st.libDesign; c.variant = st.libVariant; telopCache.delete(c.id); }
      changed({ props: true });
      toast(`${cs.length} 個のテロップのデザインを変更しました`);
    },
    addTrackVideo: () => addTrack('video'), addTrackTelop: () => addTrack('telop'), addTrackAudio: () => addTrack('audio'),
    zoomIn: () => setZoom(st.pps * 1.4), zoomOut: () => setZoom(st.pps / 1.4), zoomFit,
    toggleSafe: () => { st.safe = !st.safe; $('#btn-safe').classList.toggle('on', st.safe); requestDraw(); },
    toggleSnap: () => { st.snap = !st.snap; $('#btn-snap').classList.toggle('on', st.snap); toast(st.snap ? 'スナップ：オン' : 'スナップ：オフ'); },
    toggleLoop: () => { st.loop = !st.loop; $('#btn-loop').classList.toggle('on', st.loop); },
    togglePlay,
    goStart: () => { pause(); seek(0); scroller.scrollLeft = 0; },
    goEnd: () => { pause(); seek(duration()); followPlayhead(); },
    stepBack: () => { pause(); seek(snapFrame(st.time - 1 / fps())); followPlayhead(); },
    stepFwd: () => { pause(); seek(snapFrame(st.time + 1 / fps())); followPlayhead(); },
    prevEdit: () => { pause(); const p = editPoints().filter((x) => x < st.time - 1e-3); seek(p.length ? p[p.length - 1] : 0); followPlayhead(); },
    nextEdit: () => { pause(); const p = editPoints().find((x) => x > st.time + 1e-3); if (p != null) seek(p); followPlayhead(); },
    shortcuts: () => openModal('キーボードショートカット', shortcutsHtml(false), [['閉じる', null, true]]),
    about: () => openModal('Chain Cut について', `<p class="big">Chain Cut — ブラウザ動画編集ソフト</p><p>タイムライン編集、テロップ（Chain-Movies テロップ素材集 ${DESIGNS.length} デザイン）、BGM、無音カット、SRT 字幕読み込み、MP4 書き出しまで、インストール不要でブラウザだけで完結します。素材はこの PC のブラウザ内にだけ保存され、外部に送信されません。</p><p class="note" style="color:var(--muted);font-size:11px">推奨環境：Chrome / Edge の最新版（パソコン）。MP4 書き出しには WebCodecs を使います。<br>MP4 Muxer: mp4-muxer (MIT License, © Vanilagy)</p>`, [['閉じる', null, true]]),
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) {
      $$('.menu').forEach((m) => m.classList.remove('open'));
      const f = cmd[b.dataset.cmd]; if (f) f();
      return;
    }
    const mb = e.target.closest('.menu>button');
    if (mb) { const m = mb.parentElement; const was = m.classList.contains('open'); $$('.menu').forEach((x) => x.classList.remove('open')); if (!was) m.classList.add('open'); return; }
    if (!e.target.closest('.menu')) $$('.menu').forEach((m) => m.classList.remove('open'));
  });
  $$('.menu>button').forEach((b) => b.addEventListener('mouseenter', () => { if ($('.menu.open') && !b.parentElement.classList.contains('open')) { $$('.menu').forEach((x) => x.classList.remove('open')); b.parentElement.classList.add('open'); } }));

  $$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  function setTool(t) {
    st.tool = t;
    $$('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === t));
    content.classList.toggle('razor', t === 'razor');
    if (t !== 'razor') $('#razorline').style.display = 'none';
  }

  $$('[data-ltab]').forEach((b) => b.addEventListener('click', () => {
    st.ltab = b.dataset.ltab;
    $$('[data-ltab]').forEach((x) => x.classList.toggle('on', x === b));
    $('#tab-bin').classList.toggle('hidden', st.ltab !== 'bin');
    $('#tab-lib').classList.toggle('hidden', st.ltab !== 'lib');
    $('#btn-import').classList.toggle('hidden', st.ltab !== 'bin');
    if (st.ltab === 'lib' && !libGrid.children.length) renderLib();
  }));

  $('#file-media').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  $('#file-srt').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importSrtFile(f); e.target.value = ''; });
  $('#file-proj').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openProjectFile(f); e.target.value = ''; });
  $('#projname').addEventListener('change', (e) => { pushUndo(); P.name = e.target.value.trim() || '無題のプロジェクト'; scheduleSave(); document.title = `${P.name} — Chain Cut`; });
  $('#projname').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });

  /* キーボード */
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const run = (name) => { e.preventDefault(); cmd[name](); };
    if ($('.modal-bg')) return;
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
      // 入力中でも効くもの：保存・書き出し、Esc で入力欄から抜ける
      if (mod && (k === 's' || k === 'S')) return run(e.shiftKey ? 'savePackage' : 'save');
      if (mod && (k === 'm' || k === 'M')) return run('export');
      if (k === 'Escape') e.target.blur();
      return;
    }
    if (mod && e.altKey && (k === 'n' || k === 'N')) return run('new');
    if (mod && (k === 'z' || k === 'Z')) return run(e.shiftKey ? 'redo' : 'undo');
    if (mod && (k === 'y' || k === 'Y')) return run('redo');
    if (mod && (k === 'k' || k === 'K')) return run('split');
    if (mod && (k === 's' || k === 'S')) return run(e.shiftKey ? 'savePackage' : 'save');
    if (mod && (k === 'o' || k === 'O')) return run('open');
    if (mod && (k === 'i' || k === 'I')) return run('import');
    if (mod && (k === 'm' || k === 'M')) return run('export');
    if (mod && (k === 'c' || k === 'C')) return run('copy');
    if (mod && (k === 'v' || k === 'V')) return run('paste');
    if (mod && (k === 'd' || k === 'D')) return run('duplicate');
    if (mod && (k === 'a' || k === 'A')) return run('selectAll');
    if (mod && e.shiftKey && (k === 'x' || k === 'X')) return run('silence');
    if (mod) return;
    switch (k) {
      case ' ': return run('togglePlay');
      case 'j': case 'J': e.preventDefault(); return shuttle(-1);
      case 'k': case 'K': e.preventDefault(); return shuttle(0);
      case 'l': case 'L': e.preventDefault(); return shuttle(1);
      case 'ArrowLeft': e.preventDefault(); pause(); seek(snapFrame(st.time - (e.shiftKey ? 5 : 1) / fps())); followPlayhead(); return;
      case 'ArrowRight': e.preventDefault(); pause(); seek(snapFrame(st.time + (e.shiftKey ? 5 : 1) / fps())); followPlayhead(); return;
      case 'ArrowUp': return run('prevEdit');
      case 'ArrowDown': return run('nextEdit');
      case 'Home': return run('goStart');
      case 'End': return run('goEnd');
      case 'Delete': case 'Backspace': return run(e.shiftKey ? 'rippleDelete' : 'delete');
      case 'v': case 'V': return setTool('select');
      case 'c': case 'C': return setTool('razor');
      case 'b': case 'B': return setTool('ripple');
      case 's': case 'S': return run('toggleSnap');
      case 't': case 'T': return run('addTelop');
      case '=': case '+': return run('zoomIn');
      case '-': case '_': return run('zoomOut');
      case '\\': return run('zoomFit');
      case "'": return run('toggleSafe');
      case '?': return run('shortcuts');
      case 'Escape': return run('deselect');
      default:
    }
  });

  /* パネルのリサイズ */
  function splitter(id, axis, varName, getBase, min, max, invert) {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId); el.classList.add('drag');
      const app = $('#app');
      el.onpointermove = (ev) => {
        const v = clamp(getBase(ev), min, max());
        app.style.setProperty(varName, axis === 'h' ? v + 'px' : v + 'px');
        onResize();
      };
      el.onpointerup = () => {
        el.onpointermove = null; el.classList.remove('drag');
        try { localStorage.setItem('cc-layout', JSON.stringify({ l: app.style.getPropertyValue('--left-w'), r: app.style.getPropertyValue('--right-w'), t: app.style.getPropertyValue('--top-h') })); } catch (e2) { /* ignore */ }
      };
    });
  }
  splitter('#split-l', 'v', '--left-w', (e) => e.clientX, 200, () => window.innerWidth * 0.45);
  splitter('#split-r', 'v', '--right-w', (e) => window.innerWidth - e.clientX, 220, () => window.innerWidth * 0.45);
  splitter('#split-h', 'h', '--top-h', (e) => e.clientY - 34, 200, () => window.innerHeight - 200);
  try {
    const L = JSON.parse(localStorage.getItem('cc-layout') || 'null');
    if (L) { const app = $('#app'); if (L.l) app.style.setProperty('--left-w', L.l); if (L.r) app.style.setProperty('--right-w', L.r); if (L.t) app.style.setProperty('--top-h', L.t); }
  } catch (e) { /* ignore */ }

  let resizeQueued = false;
  function onResize() {
    if (resizeQueued) return; resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; layoutMonitor(); renderTimeline(); });
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('beforeunload', () => { if ($('#savestate').classList.contains('dirty')) autosave(); });

  /* =================================================================
     起動
     ================================================================= */
  async function boot() {
    setupLib();
    try {
      const saved = await idbGet('kv', 'project');
      if (saved && Array.isArray(saved.clips)) {
        P = Object.assign(newProject(saved.aspect, saved.fps), saved);
        for (const mm of P.media) if (mm.type === 'image') mm.duration = Infinity;
        await restoreMedia();
      }
    } catch (e) { console.warn('restore failed', e); }
    document.title = `${P.name} — Chain Cut`;
    layoutMonitor();
    changed({ structure: true });
    if (P.clips.length) zoomFit(); else setZoom(60, 0);
    $('#savestate').textContent = P.clips.length ? '前回の作業を復元しました' : '自動保存オン';
    $('#savestate').classList.remove('dirty');
    requestAnimationFrame(drawMeter);
  }

  // テスト・自動操作用の小さな公開 API
  window.ChainCut = {
    get project() { return P; }, get state() { return st; }, media,
    importFiles, cmd, seek, drawFrame, detectKeeps, applySilenceCut, parseSrt, runExport, getBuffer,
    select: (ids) => { st.sel = new Set(ids); changed({ selection: true }); },
  };

  boot();
})();
