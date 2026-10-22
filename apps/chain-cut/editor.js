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
      { id: 'V3', kind: 'video', muted: false, hidden: false },
      { id: 'V2', kind: 'video', muted: false, hidden: false },
      { id: 'V1', kind: 'video', muted: false, hidden: false },
      { id: 'A1', kind: 'audio', muted: false, hidden: false },
      { id: 'A2', kind: 'audio', muted: false, hidden: false },
      { id: 'A3', kind: 'audio', muted: false, hidden: false },
    ];
  }
  /** 旧形式の「テロップトラック」を映像トラックに変換（テロップもテキストも映像トラックに置く） */
  function normalizeProject(p) {
    if (!p || !Array.isArray(p.tracks)) return p;
    const used = new Set(p.tracks.map((t) => t.id));
    const map = {};
    const tel = p.tracks.filter((t) => t.kind === 'telop');
    let n = 1;
    // 上のトラックほど大きい番号（＝前面）
    for (const t of tel.slice().reverse()) {
      while (used.has('V' + n)) n++;
      map[t.id] = 'V' + n; used.add('V' + n);
    }
    for (const t of tel) { t.id = map[t.id]; t.kind = 'video'; }
    if (tel.length) for (const c of p.clips || []) if (map[c.track]) c.track = map[c.track];
    return p;
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
  function snapshot() { return JSON.stringify({ tracks: P.tracks, clips: P.clips, media: P.media, name: P.name, inPoint: P.inPoint, outPoint: P.outPoint, captions: P.captions || [], designs: P.designs || [] }); }
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
    normalizeProject(o);
    P.tracks = o.tracks; P.clips = o.clips; P.media = o.media; P.name = o.name; P.inPoint = o.inPoint; P.outPoint = o.outPoint; P.captions = o.captions || []; P.designs = o.designs || [];
    for (const id of Array.from(st.sel)) if (!clipById(id)) st.sel.delete(id);
    st.kfSel.clear(); layerCache.clear();
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
  function kindForType(type) { return type === 'audio' ? 'audio' : 'video'; }
  /** このクリップの音を鳴らすか（映像だけにした動画クリップは鳴らさない） */
  function hasSound(c) { return (c.type === 'video' || c.type === 'audio') && !c.audioOff && !!(mediaMeta(c.mediaId) || {}).hasAudio; }
  /** リンクされた相手（同じ素材の映像⇔音声） */
  function partners(c) { return c && c.link ? P.clips.filter((x) => x !== c && x.link === c.link) : []; }
  function withPartners(list) { const s = new Set(list); for (const c of list) for (const p of partners(c)) s.add(p); return Array.from(s); }
  function mediaMeta(id) { return P.media.find((m) => m.id === id); }
  function fadeFactor(c, t) {
    let a = 1;
    const local = t - c.start, rem = clipEnd(c) - t;
    // 先頭フレームが真っ黒（透明）にならないよう 1 フレーム分前倒し
    if (c.fadeIn > 0 && local < c.fadeIn) a *= clamp((local + 1 / fps()) / (c.fadeIn + 1 / fps()), 0, 1);
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
    perSec = perSec || 100;
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
      toast(`${added.length} 件の素材を読み込みました。「＋両方」「映像」「音声」ボタンかドラッグでタイムラインへ`);
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
    if ((type === 'video' || type === 'image') && meta.width && meta.height) {
      // 向きが違う素材（縦の画面に横の動画など）は、プロジェクトで選んだ表示方法に
      const mismatch = (meta.width > meta.height) !== (P.width > P.height) && meta.width !== meta.height && P.width !== P.height;
      c.fit = mismatch ? (P.mismatchFit || 'native') : 'contain';
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
  function trackFree(tid, start, dur, ignore) { return !P.clips.some((c) => c.track === tid && c !== ignore && c.start < start + dur - EPS && clipEnd(c) > start + EPS); }
  /** テロップ・テキスト用：その時間に使われている一番上の映像トラックより上で、空いているトラック（隠れないように）。なければ新しく作る */
  function freeVideoTrack(start, dur) {
    const vs = P.tracks.filter((t) => t.kind === 'video'); // 上が前面
    let top = vs.findIndex((t) => !trackFree(t.id, start, dur || 0.01));
    if (top < 0) top = vs.length;
    const cands = vs.slice(0, top).filter((t) => t.id !== 'V1' && !t.locked);
    return cands.length ? cands[cands.length - 1] : addTrack('video', true);
  }
  /** 音声用：同じ番号の音声トラック（V2→A2）を優先し、空いているところ。なければ新しく作る */
  function audioTrackFor(start, dur, prefer) {
    const as = P.tracks.filter((t) => t.kind === 'audio');
    if (prefer) { const p = trackById(prefer); if (p && p.kind === 'audio' && trackFree(p.id, start, dur)) return p; }
    return as.find((t) => trackFree(t.id, start, dur)) || addTrack('audio', true);
  }
  /**
   * 素材をタイムラインに置く。mode: 'both'（映像と音声を別トラックにリンクして置く）| 'video'（映像だけ）| 'audio'（音声だけ）
   * 戻り値は置いたクリップの配列
   */
  function placeMedia(meta, trackId, start, mode) {
    mode = mode || 'both';
    let tr = trackById(trackId);
    if (meta.type === 'audio' || (meta.type === 'video' && mode === 'audio')) {
      if (meta.type === 'video' && !meta.hasAudio) { toast('この動画には音声がありません'); return []; }
      const c = makeMediaClip(meta, 'A1', start);
      c.type = 'audio'; delete c.fit;
      c.track = tr && tr.kind === 'audio' ? tr.id : audioTrackFor(c.start, c.dur).id;
      P.clips.push(c); return [c];
    }
    if (!tr || tr.kind !== 'video') tr = trackById('V1') || firstTrack('video');
    const v = makeMediaClip(meta, tr.id, start);
    P.clips.push(v);
    if (meta.type !== 'video' || !meta.hasAudio) return [v];
    v.audioOff = true;
    if (mode === 'video') return [v];
    const a = makeMediaClip(meta, 'A1', v.start); a.type = 'audio'; delete a.fit;
    a.track = audioTrackFor(a.start, a.dur, 'A' + tr.id.slice(1)).id;
    v.link = a.link = uid('lk');
    P.clips.push(a);
    return [v, a];
  }
  /** Ctrl+L：リンク解除／リンク。音声つきの動画クリップ1本なら、映像と音声に分ける */
  function toggleLink() {
    const sel = P.clips.filter((c) => st.sel.has(c.id));
    if (!sel.length) return toast('クリップを選んでください');
    pushUndo();
    if (sel.some((c) => c.link)) {
      for (const c of sel) delete c.link;
      changed({ structure: true });
      return toast('リンクを解除しました（映像と音声を別々に動かせます）');
    }
    const combined = sel.filter((c) => c.type === 'video' && !c.audioOff && (mediaMeta(c.mediaId) || {}).hasAudio);
    if (combined.length) {
      for (const v of combined) {
        const a = clone(v); a.id = uid('c'); a.type = 'audio'; delete a.fit; delete a.kf; delete a.fx;
        a.track = audioTrackFor(v.start, v.dur, 'A' + v.track.slice(1)).id;
        v.audioOff = true; v.volume = 1;
        P.clips.push(a);
        st.sel.add(a.id);
      }
      changed({ structure: true });
      return toast('映像と音声を別々のトラックに分けました');
    }
    const vs = sel.filter((c) => c.type === 'video' || c.type === 'image'), as = sel.filter((c) => c.type === 'audio');
    if (!vs.length || !as.length) { undoStack.pop(); return toast('映像クリップと音声クリップを両方選ぶとリンクできます'); }
    const lk = uid('lk');
    for (const c of vs.concat(as)) c.link = lk;
    changed({ structure: true });
    toast('映像と音声をリンクしました（一緒に動きます）');
  }
  function trackEnd(trackId) { let e = 0; for (const c of P.clips) if (c.track === trackId) e = Math.max(e, clipEnd(c)); return e; }

  function appendMedia(id, mode) {
    const meta = mediaMeta(id); if (!meta || !media.has(id)) return;
    const kind = mode === 'audio' ? 'audio' : kindForType(meta.type);
    let tr = kind === 'video' ? (trackById('V1') || firstTrack('video')) : (trackById('A1') || firstTrack('audio'));
    // 音楽ファイル（BGM）は、動画の音声（リンク付き）が入っていない音声トラックへ
    if (meta.type === 'audio') tr = P.tracks.find((t) => t.kind === 'audio' && !P.clips.some((c) => c.track === t.id && c.link)) || addTrack('audio', true);
    if (!tr) return;
    pushUndo();
    const cs = placeMedia(meta, tr.id, trackEnd(tr.id), mode);
    st.sel = new Set(cs.map((c) => c.id));
    changed({ structure: true });
  }

  /* =================================================================
     編集操作
     ================================================================= */
  function splitClipAt(c, t, lm) {
    t = snapFrame(t);
    if (t <= c.start + MIN_DUR / 2 || t >= clipEnd(c) - MIN_DUR / 2) return null;
    const right = clone(c); right.id = uid('c');
    if (c.link) { lm = lm || new Map(); if (!lm.has(c.link)) lm.set(c.link, uid('lk')); right.link = lm.get(c.link); }
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
    targets = withPartners(targets).filter((c) => isActive(c, t));
    pushUndo();
    const news = [], lm = new Map();
    for (const c of targets) { const r = splitClipAt(c, t, lm); if (r) news.push(r); }
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
  function addTrack(kind, quiet) {
    if (kind !== 'audio') kind = 'video';
    if (!quiet) pushUndo();
    const prefix = kind === 'video' ? 'V' : 'A';
    let n = 1; while (trackById(prefix + n)) n++;
    const t = { id: prefix + n, kind, muted: false, hidden: false };
    // 表示順：映像（上が前面） → 音声
    if (kind === 'audio') P.tracks.push(t);
    else {
      const idx = P.tracks.findIndex((x) => x.kind === kind);
      P.tracks.splice(idx < 0 ? 0 : idx, 0, t);
    }
    if (!quiet) { changed({ structure: true }); toast(`${t.id}（${kind === 'video' ? '映像' : '音声'}トラック）を追加しました`); }
    return t;
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
  function telopKey(c, W, H) { return [c.designId, c.variant, c.text, c.sub, c.scale, W, H, fontReady.size, c.colorOv ? JSON.stringify(c.colorOv) : ''].join('|'); }
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
      const td = telopDesignFor(c);
      const out = R.render(canvas, td.d, { width: W, height: H, variant: td.variant, text: c.text || '', sub: c.sub || '', scale: (c.scale || 100) / 100 });
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

  /* ---------- キーフレーム・トランジション・エフェクト ---------- */
  const KF_PROPS = ['x', 'y', 'scale', 'opacity', 'rotation'];
  const KF_DEFAULT = { x: 0, y: 0, scale: 100, opacity: 100, rotation: 0 };
  const EASE = {
    linear: (x) => x,
    easeIn: (x) => x * x * x,
    easeOut: (x) => 1 - Math.pow(1 - x, 3),
    easeInOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    back: (x) => easeOutBack(x),
    hold: () => 0,
  };
  function baseVal(c, prop) { const v = c[prop]; return v == null ? KF_DEFAULT[prop] : v; }
  function hasKf(c, prop) { return !!(c.kf && c.kf[prop] && c.kf[prop].length); }
  function kfValue(c, prop, t) {
    const k = c.kf && c.kf[prop];
    if (!k || !k.length) return baseVal(c, prop);
    return kfAt(k, t - c.start);
  }
  function setKf(c, prop, lt, v, ease) {
    c.kf = c.kf || {};
    const k = c.kf[prop] = c.kf[prop] || [];
    lt = clamp(Math.round(lt * fps()) / fps(), 0, c.dur);
    const i = k.findIndex((x) => Math.abs(x[0] - lt) < 0.5 / fps());
    if (i >= 0) k[i][1] = v; else { k.push([lt, v, ease || 'easeInOut']); k.sort((a, b) => a[0] - b[0]); }
  }
  function noise(seed, t) { return Math.sin(t * 37.1 + seed) * 0.6 + Math.sin(t * 61.7 + seed * 2.3) * 0.4; }
  const TRANSITIONS = [['', 'なし'], ['zoom', 'ズーム'], ['zoomOut', 'ズームアウト'], ['slideL', 'スライド（横）'], ['slideUp', 'スライド（縦）'], ['whip', 'ホイップ（高速パン）'], ['spin', 'スピン'], ['flash', 'フラッシュ（白）'], ['dip', '暗転'], ['blur', 'ぼかし']];
  /** 時刻 t の見た目（キーフレーム・トランジション・揺れを反映） */
  function animated(c, t, W, H) {
    const e = { x: kfValue(c, 'x', t), y: kfValue(c, 'y', t), scale: kfValue(c, 'scale', t), opacity: kfValue(c, 'opacity', t), rotation: kfValue(c, 'rotation', t), blur: 0, flash: 0, dip: 0 };
    const lt = t - c.start, rem = clipEnd(c) - t;
    const tr = (spec, p, dir) => { // p: 0→1（1 で通常の状態）
      p = clamp(p, 0, 1);
      const q = 1 - EASE.easeOut(p);
      switch (spec.type) {
        case 'zoom': e.scale *= 1 + 0.3 * q; break;
        case 'zoomOut': e.scale *= 1 - 0.25 * q; break;
        case 'slideL': e.x += dir * W * q; break;
        case 'slideUp': e.y += dir * H * q; break;
        case 'whip': e.x += dir * W * 0.5 * q; e.blur = Math.max(e.blur, 40 * q); break;
        case 'spin': e.rotation += dir * -120 * q; e.scale *= 1 - 0.6 * q; break;
        case 'flash': e.flash = Math.max(e.flash, 1 - p); break;
        case 'dip': e.dip = Math.max(e.dip, 1 - p); break;
        case 'blur': e.blur = Math.max(e.blur, 30 * q); break;
        default:
      }
    };
    if (c.trIn && c.trIn.type && c.trIn.dur > 0 && lt < c.trIn.dur) tr(c.trIn, (lt + 1 / fps()) / (c.trIn.dur + 1 / fps()), 1);
    if (c.trOut && c.trOut.type && c.trOut.dur > 0 && rem < c.trOut.dur) tr(c.trOut, rem / c.trOut.dur, -1);
    const fx = c.fx || {};
    if (fx.shake > 0) { e.x += fx.shake * noise(1.3, t); e.y += fx.shake * noise(4.1, t); }
    return e;
  }
  function filterOf(c, e) {
    const fx = c.fx || {}, f = [];
    if (fx.brightness != null && fx.brightness !== 100) f.push(`brightness(${fx.brightness}%)`);
    if (fx.contrast != null && fx.contrast !== 100) f.push(`contrast(${fx.contrast}%)`);
    if (fx.saturate != null && fx.saturate !== 100) f.push(`saturate(${fx.saturate}%)`);
    if (fx.hue) f.push(`hue-rotate(${fx.hue}deg)`);
    if (fx.grayscale) f.push(`grayscale(${fx.grayscale}%)`);
    if (fx.sepia) f.push(`sepia(${fx.sepia}%)`);
    const b = (fx.blur || 0) + (e ? e.blur : 0);
    if (b > 0.3) f.push(`blur(${b.toFixed(1)}px)`);
    return f.length ? f.join(' ') : 'none';
  }
  function drawOverlays(ctx, c, e, W, H) {
    const fx = c.fx || {};
    if (fx.vignette > 0) {
      ctx.save();
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${clamp(fx.vignette / 100, 0, 1)})`);
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    if (e.flash > 0.001) { ctx.save(); ctx.globalAlpha = e.flash; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    if (e.dip > 0.001) { ctx.save(); ctx.globalAlpha = e.dip; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  }

  function visualRect(c, sw, sh, W, H) {
    // native：素材と同じ向きの画面に収めたときの大きさ（横→縦に切り替えても縮まない）
    const fit = c.fit === 'cover' ? Math.max(W / sw, H / sh) : c.fit === 'stretch' ? null : c.fit === 'native' ? Math.min(Math.max(W, H) / Math.max(sw, sh), Math.min(W, H) / Math.min(sw, sh)) : Math.min(W / sw, H / sh);
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
        const ea = animated(c, t, W, H);
        const alpha = clamp(ea.opacity / 100, 0, 1) * fadeFactor(c, t);
        if (alpha <= 0.001) { drawOverlays(ctx, c, ea, W, H); continue; }
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
          const r = visualRect(Object.assign({}, c, { x: ea.x, y: ea.y, scale: ea.scale }), sw, sh, W, H);
          ctx.save();
          ctx.imageSmoothingQuality = 'high';
          ctx.filter = filterOf(c, ea);
          if (ea.rotation) { const cx = r.x + r.w / 2, cy = r.y + r.h / 2; ctx.translate(cx, cy); ctx.rotate(ea.rotation * Math.PI / 180); ctx.translate(-cx, -cy); }
          ctx.drawImage(src, r.x, r.y, r.w, r.h);
          ctx.restore();
          drawOverlays(ctx, c, ea, W, H);
          rects[c.id] = r;
        } else if (c.type === 'graphic') {
          rects[c.id] = drawGraphic(ctx, c, ea, W, H, t);
          drawOverlays(ctx, c, ea, W, H);
        } else if (c.type === 'shape') {
          rects[c.id] = drawShape(ctx, c, ea, W, H);
          drawOverlays(ctx, c, ea, W, H);
        } else if (c.type === 'telop') {
          const e = telopCanvas(c, W, H);
          if (!e) continue;
          const p = (t - c.start);
          const ad = 0.35;
          ctx.save();
          let ox = ea.x, oy = ea.y;
          const r = e.rect || { x: 0, y: 0, w: W, h: H };
          {
            // キーフレームのスケール・回転は描画済みテロップへの変形で（毎フレーム描き直さない）
            const ks = ea.scale / (c.scale || 100);
            if (Math.abs(ks - 1) > 1e-3 || ea.rotation) {
              const cx = r.x + r.w / 2 + ox, cy = r.y + r.h / 2 + oy;
              ctx.translate(cx, cy); ctx.rotate((ea.rotation || 0) * Math.PI / 180); ctx.scale(ks, ks); ctx.translate(-cx, -cy);
            }
            ctx.filter = filterOf(c, ea);
          }
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
          rects[c.id] = { x: r.x + ea.x, y: r.y + ea.y, w: r.w, h: r.h };
          if (isLocked(c.designId) && !opt.noSample) drawSample(ctx, rects[c.id]);
          drawOverlays(ctx, c, ea, W, H);
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
      // 選択中のレイヤー（グラフィックの中）
      for (const id of st.sel) {
        const c = clipById(id); const L = selectedLayer(c);
        const r = L && layerRects[id] && layerRects[id][L.id];
        if (!r) continue;
        octx.save(); octx.strokeStyle = '#ffd84d'; octx.lineWidth = Math.max(2, W / 600); octx.setLineDash([10, 6]);
        octx.strokeRect(r.x, r.y, r.w, r.h); octx.setLineDash([]);
        const hs = Math.max(10, W / 120); octx.fillStyle = '#ffd84d';
        for (const [hx, hy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) octx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        octx.restore();
      }
      drawMotionPath();
      for (const id of st.sel) {
        if (selectedLayer(clipById(id))) continue;
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
      const vol = (tr.muted || c.audioOff ? 0 : (c.volume == null ? 1 : c.volume)) * fadeFactor(c, t);
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
    const io = st.loop ? inOut() : null;
    const end = io ? io[1] : duration();
    if (t >= end) {
      if (st.loop && end > 0) { t = io ? io[0] : 0; playT0 = t; playP0 = now; }
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
    const sw = Math.max(40, stage.clientWidth - 24), sh = Math.max(40, stage.clientHeight - 24);
    const k = Math.max(0.02, Math.min(sw / P.width, sh / P.height));
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
    if (pathPointerDown(e, pt)) return;
    if (graphicPointerDown(e, pt)) return;
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
    const start = { x: kfValue(hit, 'x', st.time), y: kfValue(hit, 'y', st.time), scale: kfValue(hit, 'scale', st.time) };
    const cx = r0 ? r0.x + r0.w / 2 : P.width / 2, cy = r0 ? r0.y + r0.h / 2 : P.height / 2;
    const d0 = Math.hypot(pt.x - cx, pt.y - cy) || 1;
    let moved = false;
    overlay.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const q = monitorPoint(ev);
      if (!moved) { pushUndo(); moved = true; }
      if (corner) {
        setProp(hit, 'scale', clamp(Math.round(start.scale * Math.hypot(q.x - cx, q.y - cy) / d0), 5, 800));
      } else {
        let nx = Math.round(start.x + q.x - pt.x), ny = Math.round(start.y + q.y - pt.y);
        if (!ev.altKey && hit.type !== 'telop') { if (Math.abs(nx) < 12) nx = 0; if (Math.abs(ny) < 12) ny = 0; }
        if (ev.shiftKey) { if (Math.abs(nx - start.x) > Math.abs(ny - start.y)) ny = start.y; else nx = start.x; }
        setProp(hit, 'x', nx); setProp(hit, 'y', ny);
      }
      requestDraw(); renderInspectorValues();
    };
    const up = () => {
      overlay.removeEventListener('pointermove', move); overlay.removeEventListener('pointerup', up);
      if (moved) changed({ props: true });
    };
    overlay.addEventListener('pointermove', move); overlay.addEventListener('pointerup', up);
  });
  /** グラフィックのレイヤーをクリック・ドラッグ。処理したら true */
  function graphicPointerDown(e, pt) {
    const order = [];
    for (const tr of compositeTracks()) if (!tr.hidden) for (const c of P.clips.filter((x) => x.track === tr.id && isActive(x, st.time))) order.push(c);
    for (let i = order.length - 1; i >= 0; i--) {
      const c = order[i];
      if (c.type !== 'graphic') { const r = lastRects[c.id]; if (r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return false; continue; }
      const rs = layerRects[c.id] || {};
      const hitL = (c.layers || []).slice().reverse().find((L) => { const r = rs[L.id]; return L.visible !== false && !L.locked && r && pt.x >= r.x - 6 && pt.x <= r.x + r.w + 6 && pt.y >= r.y - 6 && pt.y <= r.y + r.h + 6; });
      if (!hitL) continue;
      if (e.altKey) return false; // Alt+ドラッグはグラフィック全体
      st.sel = new Set([c.id]);
      const changedSel = !st.selLayer || st.selLayer.layerId !== hitL.id;
      st.selLayer = { clipId: c.id, layerId: hitL.id };
      if (changedSel) { st.kfSel.clear(); changed({ selection: true }); }
      const r0 = rs[hitL.id];
      const corner = [[r0.x, r0.y], [r0.x + r0.w, r0.y], [r0.x, r0.y + r0.h], [r0.x + r0.w, r0.y + r0.h]].some(([hx, hy]) => Math.abs(hx - pt.x) < P.width / 60 && Math.abs(hy - pt.y) < P.width / 60);
      const lt = st.time - c.start, gk = kfValue(c, 'scale', st.time) / 100;
      const sx = layerVal(hitL, 'x', lt), sy = layerVal(hitL, 'y', lt), ss = layerVal(hitL, 'scale', lt);
      const d0 = Math.hypot(pt.x - r0.cx, pt.y - r0.cy) || 1;
      let moved = false;
      overlay.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const q = monitorPoint(ev);
        if (!moved) { pushUndo(); moved = true; }
        if (corner) setLayerProp(c, hitL, 'scale', clamp(Math.round(ss * Math.hypot(q.x - r0.cx, q.y - r0.cy) / d0), 1, 2000));
        else {
          let nx = Math.round(sx + (q.x - pt.x) / gk), ny = Math.round(sy + (q.y - pt.y) / gk);
          if (ev.shiftKey) { if (Math.abs(nx - sx) > Math.abs(ny - sy)) ny = sy; else nx = sx; }
          setLayerProp(c, hitL, 'x', nx); setLayerProp(c, hitL, 'y', ny);
        }
        requestDraw(); renderInspectorValues(); drawKfStrip();
      };
      const up = () => { overlay.removeEventListener('pointermove', mv); overlay.removeEventListener('pointerup', up); if (moved) changed({ props: true, light: true }); };
      overlay.addEventListener('pointermove', mv); overlay.addEventListener('pointerup', up);
      return true;
    }
    return false;
  }
  overlay.addEventListener('dblclick', () => { const ta = $('#L-text') || $('#t-text'); if (ta) { ta.focus(); ta.select(); } });
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
    highlightCaption();
    if (!st.playing || (performance.now() % 4 < 1)) drawKfStrip();
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
  const TRACK_H = { video: 70, telop: 38, audio: 64 };
  try { Object.assign(TRACK_H, JSON.parse(localStorage.getItem('cc-trackh') || '{}')); } catch (e) { /* ignore */ }
  const TRACK_SIZES = { video: [70, 100, 140], audio: [64, 96, 140], telop: [38, 52] };
  let HEAD_W = 150;
  function readHeadW() { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tl-head')); if (v > 0) HEAD_W = v; }
  readHeadW();
  window.addEventListener('resize', () => { const o = HEAD_W; readHeadW(); if (o !== HEAD_W) renderTimeline(); });

  const ICON = {
    eye: '<svg viewBox="0 0 24 24"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 4.3L4.3 3 21 19.7 19.7 21l-3.1-3.1A11 11 0 0112 19C6 19 2 12 2 12a18 18 0 014.4-5.1zM12 5c6 0 10 7 10 7a18 18 0 01-3 3.9L8.6 5.5A10 10 0 0112 5z"/></svg>',
    spk: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0014 8v8a4.5 4.5 0 002.5-4z"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.6 3l2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
  };
  const TRACK_COL = { video: '#4a6fa5', telop: '#b5692e', audio: '#3d8a5f' };
  const TRACK_LBL = { video: '映像', telop: '映像', audio: '音声' };

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
      const sizeBtn = tr.kind !== 'telop' ? `<button class="ib" data-theight="${tr.kind}" title="トラックの高さ（波形を大きく）"><svg viewBox="0 0 24 24"><path d="M12 3l4 4h-3v10h3l-4 4-4-4h3V7H8z"/></svg></button>` : '';
      html += `<div class="trow k-${tr.kind}" data-track="${tr.id}" style="height:${h}px">
        <div class="thead"><span class="tn" style="background:${TRACK_COL[tr.kind]}">${tr.id}</span><span class="tl">${TRACK_LBL[tr.kind]}</span>${sizeBtn}${vis}<button class="ib tdel" data-tdel="${tr.id}" title="トラックを削除">${ICON.x}</button></div>
        <div class="lane" data-lane="${tr.id}"></div></div>`;
    }
    html += `<div class="addrow"><div class="thead"><button class="btn sm" data-addtrack="video" title="映像トラックを追加（ここに素材をドロップしても追加できます）">＋映像</button><button class="btn sm" data-addtrack="audio" title="音声トラックを追加">＋音声</button></div><div class="lane"><span>ここにドロップすると新しいトラックに置きます</span></div></div>`;
    rows.innerHTML = html;
    for (const c of P.clips) {
      const lane = rows.querySelector(`[data-lane="${c.track}"]`);
      if (!lane) continue;
      lane.appendChild(clipEl(c));
    }
    content.classList.toggle('razor', st.tool === 'razor');
    drawInOut();
    drawRuler();
    updateTimeUI();
  }

  function clipLabel(c) {
    if (c.type === 'telop') return (c.text || '').replace(/\n/g, ' ') || '（空のテロップ）';
    if (c.type === 'shape') return 'シェイプ：' + (SHAPE_NAME[c.shape] || c.shape);
    if (c.type === 'graphic') return (c.name || 'グラフィック') + `（${(c.layers || []).length}レイヤー）`;
    const m = mediaMeta(c.mediaId);
    return m ? m.name : '（素材なし）';
  }
  function clipEl(c) {
    const el = document.createElement('div');
    const tr = trackById(c.track);
    const rt = media.get(c.mediaId);
    el.className = `clip t-${c.type}` + (st.sel.has(c.id) ? ' sel' : '') + (tr && (tr.hidden || tr.muted) && (tr.kind !== 'video' || tr.hidden) ? ' off' : '') + (!['telop', 'shape', 'graphic'].includes(c.type) && !rt ? ' unlinked' : '');
    el.dataset.clip = c.id;
    el.style.left = (c.start * st.pps) + 'px';
    el.style.width = Math.max(2, c.dur * st.pps) + 'px';
    if (rt && rt.thumb && (c.type === 'video' || c.type === 'image')) {
      el.style.backgroundImage = `url(${rt.thumb})`;
      el.style.backgroundSize = 'auto ' + Math.max(20, TRACK_H.video - 16 - (rt.peaks ? Math.max(22, Math.round(TRACK_H.video * 0.42)) : 0)) + 'px'; el.style.backgroundPosition = '0 16px';
    }
    if (c.link) el.classList.add('linked');
    if (c.audioOff) el.classList.add('aoff');
    let inner = `<div class="cl">${c.link ? '<i class="lk" title="映像と音声がリンクされています（Ctrl+L で解除）">🔗</i>' : ''}${c.type === 'audio' && (mediaMeta(c.mediaId) || {}).type === 'video' ? '♪ ' : ''}${escapeHtml(clipLabel(c))}${c.volume != null && c.volume !== 1 && c.type !== 'telop' && c.type !== 'image' ? ` ・ ${volToDb(c.volume)}dB` : ''}</div>`;
    if (c.fadeIn > 0) inner += `<div class="fade i" style="width:${c.fadeIn * st.pps}px"></div>`;
    if (c.fadeOut > 0) inner += `<div class="fade o" style="width:${c.fadeOut * st.pps}px"></div>`;
    if (c.kf) {
      const ts = new Set();
      for (const k of Object.values(c.kf)) for (const x of k) ts.add(+x[0].toFixed(3));
      for (const x of ts) inner += `<i class="kfd" style="left:${x * st.pps - 4}px"></i>`;
    }
    if (c.trIn && c.trIn.type) inner += `<i class="trm l" style="width:${c.trIn.dur * st.pps}px"></i>`;
    if (c.trOut && c.trOut.type) inner += `<i class="trm r" style="width:${c.trOut.dur * st.pps}px"></i>`;
    inner += '<div class="eh l"></div><div class="eh r"></div>';
    el.innerHTML = inner;
    if (rt && rt.peaks && (c.type === 'audio' || (c.type === 'video' && !c.audioOff))) el.appendChild(waveCanvas(c, rt));
    return el;
  }

  /** 波形：素材ごとに最大値で正規化し、小さい声も見えるようにやや持ち上げて描く */
  function waveCanvas(c, rt) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(2, Math.round(c.dur * st.pps));
    const isA = c.type === 'audio';
    const cssH = isA ? TRACK_H.audio - 22 : Math.max(22, Math.round(TRACK_H.video * 0.42));
    const w = Math.min(8000, Math.round(cssW * dpr)), h = Math.round(cssH * dpr);
    const cv = document.createElement('canvas'); cv.className = 'wf';
    cv.width = w; cv.height = h; cv.style.height = cssH + 'px';
    const g = cv.getContext('2d');
    const pk = rt.peaks;
    const meta = mediaMeta(c.mediaId) || {};
    const per = meta.duration > 0 ? pk.length / meta.duration : 100;
    if (!rt.pkMax) { let mx = 1; for (const v of pk) if (v > mx) mx = v; rt.pkMax = mx; }
    const vol = clamp(c.volume == null ? 1 : c.volume, 0, 2);
    g.fillStyle = isA ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.5)';
    g.fillRect(0, 0, w, h);
    const mid = isA ? h / 2 : h / 2;
    g.fillStyle = isA ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.14)';
    g.fillRect(0, Math.floor(mid), w, Math.max(1, dpr | 0));
    const col = isA ? '#8ff5bd' : '#a9d6ff';
    const colHot = '#ffcf5c', colClip = '#ff6b6b';
    for (let x = 0; x < w; x++) {
      const ts = (c.in || 0) + (x / w) * c.dur, te = (c.in || 0) + ((x + 1) / w) * c.dur;
      let mx = 0;
      const i0 = Math.floor(ts * per), i1 = Math.max(i0, Math.floor(te * per));
      for (let i = i0; i <= i1 && i < pk.length; i++) if (pk[i] > mx) mx = pk[i];
      const raw = (mx / 255) * vol;                     // 実際の音量（1 で 0dBFS）
      const v = Math.pow(Math.min(1, mx / rt.pkMax * vol), 0.65); // 表示用（正規化＋持ち上げ）
      const a = Math.max(dpr, v * (h - 2 * dpr) / 2);
      g.fillStyle = raw >= 0.99 ? colClip : raw > 0.7 ? colHot : col;
      g.fillRect(x, mid - a, 1, a * 2);
    }
    return cv;
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
    // イン／アウト
    const io = inOut();
    if (io) {
      const a = io[0] * st.pps - x0, b = io[1] * st.pps - x0;
      rctx.fillStyle = 'rgba(45,140,235,.35)'; rctx.fillRect(a, 14, b - a, 12);
      rctx.fillStyle = '#4fa3f7';
      if (P.inPoint != null) { rctx.fillRect(a, 0, 2, 26); rctx.fillRect(a, 0, 7, 2); rctx.fillRect(a, 24, 7, 2); }
      if (P.outPoint != null) { rctx.fillRect(b - 2, 0, 2, 26); rctx.fillRect(b - 7, 0, 7, 2); rctx.fillRect(b - 7, 24, 7, 2); }
    }
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
    if (btn && btn.dataset.addtrack) { addTrack(btn.dataset.addtrack); return; }
    if (e.target.closest('.addrow')) return;
    if (btn) {
      if (btn.dataset.theight) {
        const k = btn.dataset.theight, sz = TRACK_SIZES[k], i = sz.indexOf(TRACK_H[k]);
        TRACK_H[k] = sz[(i + 1) % sz.length];
        try { localStorage.setItem('cc-trackh', JSON.stringify(TRACK_H)); } catch (e2) { /* ignore */ }
        renderTimeline(); return;
      }
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
    if (!clipDiv && e.pointerType === 'touch') {
      // タッチ：指を離したときに動いていなければ「タップ」＝再生ヘッド移動（スワイプはスクロール）
      const x0 = e.clientX, y0 = e.clientY;
      const upH = (ev) => {
        rows.removeEventListener('pointercancel', cancelH);
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) return;
        if (st.playing) pause();
        st.sel.clear(); seek(snapFrame(timeAtX(ev.clientX))); changed({ selection: true });
      };
      const cancelH = () => rows.removeEventListener('pointerup', upH);
      rows.addEventListener('pointerup', upH, { once: true });
      rows.addEventListener('pointercancel', cancelH, { once: true });
      return;
    }
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
    st.primary = c.id;
    if (st.tool === 'razor') {
      let tt = snapFrame(t);
      const lm = new Map();
      if (e.shiftKey) {
        pushUndo();
        for (const x of P.clips.filter((x) => isActive(x, tt))) splitClipAt(x, tt, lm);
      } else {
        const sn = snapTo(tt, snapCandidates(new Set([c.id]))); tt = sn.t;
        pushUndo();
        for (const x of (e.altKey ? [c] : withPartners([c]))) if (isActive(x, tt)) splitClipAt(x, tt, lm);
      }
      changed({ structure: true });
      return;
    }
    const group = e.altKey ? [c] : withPartners([c]);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const on = !st.sel.has(c.id);
      for (const x of group) { if (on) st.sel.add(x.id); else st.sel.delete(x.id); }
      changed({ selection: true });
      return;
    }
    const wasSel = st.sel.has(c.id);
    if (!st.sel.has(c.id) || (e.altKey && st.sel.size > 1)) { st.sel = new Set(group.map((x) => x.id)); changed({ selection: true }); }
    const edge = e.target.classList.contains('eh') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
    // タッチ：1回目のタップは選択だけ（そのままスワイプでスクロールできる）。選択済みならドラッグで移動
    if (e.pointerType === 'touch' && !wasSel && !edge) return;
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
        if (['image', 'telop', 'shape', 'graphic'].includes(c.type)) c.in = 0;
      }
      if (edge) {
        // リンクされた相手（映像⇔音声）も同じだけトリム
        for (const x of sel) {
          if (x === c || !c.link || x.link !== c.link) continue;
          const ox = orig.get(x.id);
          if (Math.abs(ox.start - o.start) > EPS || Math.abs(ox.dur - o.dur) > EPS) continue;
          x.start = c.start; x.dur = c.dur; x.in = c.in;
        }
      } else {
        // 移動：スナップは選択の先頭と末尾どちらでも
        const minStart = Math.min(...sel.map((x) => orig.get(x.id).start));
        dt = Math.max(dt, -minStart);
        let ns = o.start + dt;
        const s1 = snapTo(ns, cands), s2 = snapTo(ns + o.dur, cands);
        if (s1.hit != null && (s2.hit == null || Math.abs(s1.t - ns) <= Math.abs(s2.t - (ns + o.dur)))) { dt = s1.t - o.start; snapHit = s1.hit; }
        else if (s2.hit != null) { dt = s2.t - o.dur - o.start; snapHit = s2.hit; }
        for (const x of sel) { const ox = orig.get(x.id); x.start = snapFrame(Math.max(0, ox.start + dt)); }
        if (sel.every((x) => x === c || (c.link && x.link === c.link))) {
          const tr = trackAtY(ev.clientY);
          if (tr && tr.kind === trackById(o.track).kind && !tr.locked) c.track = tr.id;
        }
      }
      showSnap(snapHit);
      renderTimeline();
      if (!st.playing) requestDraw();
    };
    const up = () => {
      rows.removeEventListener('pointermove', move); rows.removeEventListener('pointerup', up); rows.removeEventListener('pointercancel', up);
      showSnap(null);
      if (moved) {
        undoStack.push(snapStr); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; lastCoalesce.key = null;
        changed({ structure: true });
      }
    };
    rows.addEventListener('pointermove', move); rows.addEventListener('pointerup', up); rows.addEventListener('pointercancel', up);
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
    if (!types.includes('text/x-cc-media') && !types.includes('text/x-cc-telop') && !types.includes('text/x-cc-se') && !types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const tr = trackAtY(e.clientY);
    $$('.trow', rows).forEach((r) => r.classList.toggle('dropok', !!tr && r.dataset.track === tr.id));
    const ar = $('.addrow', rows); if (ar) ar.classList.toggle('dropok', !!e.target.closest('.addrow'));
    showSnap(snapTo(timeAtX(e.clientX), snapCandidates(new Set())).hit);
  });
  rows.addEventListener('dragleave', (e) => { if (!rows.contains(e.relatedTarget)) { $$('.trow,.addrow', rows).forEach((r) => r.classList.remove('dropok')); showSnap(null); } });
  rows.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation();
    $$('.trow,.addrow', rows).forEach((r) => r.classList.remove('dropok')); showSnap(null);
    const t = snapFrame(snapTo(timeAtX(e.clientX), snapCandidates(new Set())).t);
    let tr = trackAtY(e.clientY);
    const mid = e.dataTransfer.getData('text/x-cc-media');
    const did = e.dataTransfer.getData('text/x-cc-telop');
    const sef = e.dataTransfer.getData('text/x-cc-se');
    const toNew = !!e.target.closest('.addrow');
    if (sef) { await addSe(sef, t, tr && tr.id); return; }
    if (mid) {
      const meta = mediaMeta(mid); if (!meta) return;
      let mode = e.dataTransfer.getData('text/x-cc-mode') || 'both';
      pushUndo();
      // 音声トラックに動画を落とした → 音声だけ。新しいトラック行に落とした → 新しく作る
      if (meta.type === 'video' && tr && tr.kind === 'audio' && mode === 'both') mode = 'audio';
      if (toNew) tr = addTrack(meta.type === 'audio' || mode === 'audio' ? 'audio' : 'video', true);
      const cs = placeMedia(meta, tr && tr.id, t, mode);
      st.sel = new Set(cs.map((c) => c.id));
      changed({ structure: true });
    } else if (did) {
      pushUndo();
      if (toNew) tr = addTrack('video', true);
      else if (!tr || tr.kind !== 'video') tr = freeVideoTrack(t, 3);
      st.libDesign = did;
      const c = makeTelopClip(tr.id, t);
      P.clips.push(c); st.sel = new Set([c.id]);
      changed({ structure: true });
    } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
      const added = await importFiles(e.dataTransfer.files);
      if (added.length) {
        pushUndo();
        let tt = t;
        for (const meta of added) {
          const cs = placeMedia(meta, tr && tr.id, tt, meta.type === 'video' && tr && tr.kind === 'audio' ? 'audio' : 'both');
          if (cs.length) tt = clipEnd(cs[0]);
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
        ${rt ? `<div class="mact">${m.type === 'video' && m.hasAudio ? `<button data-place="both" title="映像と音声を置く（別トラックにリンク）">＋両方</button><button data-place="video" draggable="true" title="映像だけを置く（ドラッグもできます）">🎞映像</button><button data-place="audio" draggable="true" title="音声だけを置く（ドラッグもできます）">♪音声</button>` : `<button data-place="both" title="タイムラインの最後に置く">＋置く</button>`}</div>` : ''}
        ${rt && rt.busy ? '<div class="busy">解析中…</div>' : ''}</div>`;
    }).join('');
  }
  $('#bin').addEventListener('dragstart', (e) => {
    const card = e.target.closest('.mcard'); if (!card) return;
    e.dataTransfer.setData('text/x-cc-media', card.dataset.media);
    const pb = e.target.closest && e.target.closest('[data-place]');
    e.dataTransfer.setData('text/x-cc-mode', pb ? pb.dataset.place : 'both');
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
    const pb = e.target.closest('[data-place]');
    if (pb) { appendMedia(card.dataset.media, pb.dataset.place); toast(pb.dataset.place === 'audio' ? '音声だけを置きました' : pb.dataset.place === 'video' ? '映像だけを置きました' : 'タイムラインに置きました'); if (window.innerWidth <= 820) closeSheets(); return; }
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
            placeMedia(meta, tr.id, trackEnd(tr.id), 'both');
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
  function projectDesigns() { return Array.isArray(P.designs) ? P.designs : []; }
  function registerProjectDesigns() {
    for (const d of projectDesigns()) { if (!d.pack) d.pack = 'project'; designById.set(d.id, d); }
    refreshPackSelect();
  }
  function refreshPackSelect() {
    const sel = $('#lib-pack'); if (!sel) return;
    const packs = {};
    for (const d of DESIGNS) packs[d.pack || 'tv-vol1'] = (packs[d.pack || 'tv-vol1'] || 0) + 1;
    const pd = projectDesigns().length;
    sel.innerHTML = (pd ? `<option value="project">★ このプロジェクトのデザイン（${pd}）</option>` : '') + '<option value="">すべてのパック（' + DESIGNS.length + '）</option>' +
      Object.keys(packs).map((k) => `<option value="${k}">${escapeHtml((PACKS[k] && PACKS[k].short) || k)}（${packs[k]}）</option>`).join('');
    sel.value = st.libPack && (st.libPack !== 'project' || pd) ? st.libPack : '';
  }
  function setupLib() {
    const sel = $('#lib-pack');
    refreshPackSelect();
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
    const list = projectDesigns().concat(DESIGNS).filter((d) => (!st.libPack || d.pack === st.libPack) &&
      (!q || [d.name, d.category, d.sample, d.id, (PACKS[d.pack] || {}).short].join(' ').toLowerCase().includes(q)));
    libGrid.innerHTML = list.slice(0, 600).map((d) => `<div class="dcard${st.libDesign === d.id ? ' sel' : ''}${isLocked(d.id) ? ' locked' : ''}" draggable="true" data-design="${d.id}" title="${escapeHtml(d.name)}（${escapeHtml(d.category || '')}）${isLocked(d.id) ? ' ・ 製品版デザイン（試せますが書き出しに透かし）' : ''}"><canvas width="360" height="150"></canvas><div class="nm">${isLocked(d.id) ? '<span class="lock">PRO</span>' : ''}${escapeHtml(d.name)}</div></div>`).join('') || '<div class="note" style="padding:12px;color:var(--muted)">該当するデザインがありません</div>';
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
     効果音（SE）パネル — se/ の自作効果音
     ================================================================= */
  let seList = null, seAudio = null;
  async function renderSe() {
    const box = $('#se-list');
    if (!seList) { try { seList = await (await fetch('se/index.json')).json(); } catch (e) { seList = []; } }
    if (!seList.length) { box.innerHTML = '<div class="note" style="padding:12px;color:var(--muted)">効果音を読み込めませんでした</div>'; return; }
    const cats = {};
    for (const s of seList) (cats[s.cat] = cats[s.cat] || []).push(s);
    box.innerHTML = Object.entries(cats).map(([cat, arr]) => `<div class="se-cat">${escapeHtml(cat)}</div>` + arr.map((s) => `
      <div class="se-item" draggable="true" data-se="${s.file}" title="ダブルクリックで再生ヘッドに追加・ドラッグでタイムラインへ">
        <button class="ib" data-seplay="${s.file}"><svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg></button>
        <span class="nm">${escapeHtml(s.name)}</span><span class="unit">${s.dur.toFixed(1)}s</span><button class="btn sm" data-seadd="${s.file}" title="再生ヘッドの位置に追加">＋</button></div>`).join('')).join('');
  }
  async function seMedia(file) {
    const name = 'SE_' + file;
    const ex = P.media.find((m) => m.name === name && media.has(m.id));
    if (ex) return ex;
    const b = await (await fetch('se/' + file)).blob();
    const added = await importFiles([new File([b], name, { type: 'audio/wav' })]);
    return added[0];
  }
  async function addSe(file, t, trackId) {
    const m = await seMedia(file); if (!m) return;
    let tr = trackId ? trackById(trackId) : null;
    pushUndo();
    const c = makeMediaClip(m, 'A1', t); c.volume = 0.7;
    c.track = tr && tr.kind === 'audio' ? tr.id : audioTrackFor(c.start, c.dur, 'A2').id;
    P.clips.push(c); st.sel = new Set([c.id]);
    changed({ structure: true });
  }
  $('#se-list').addEventListener('click', (e) => {
    const ad = e.target.closest('[data-seadd]');
    if (ad) { addSe(ad.dataset.seadd, st.time).then(() => { toast('効果音を追加しました'); if (isMobile()) closeSheets(); }); return; }
    const b = e.target.closest('[data-seplay]'); if (!b) return;
    if (seAudio) seAudio.pause();
    seAudio = new Audio('se/' + b.dataset.seplay); seAudio.play().catch(() => {});
  });
  $('#se-list').addEventListener('dblclick', (e) => { const it = e.target.closest('[data-se]'); if (it) addSe(it.dataset.se, st.time); });
  $('#se-list').addEventListener('dragstart', (e) => { const it = e.target.closest('[data-se]'); if (!it) return; e.dataTransfer.setData('text/x-cc-se', it.dataset.se); e.dataTransfer.effectAllowed = 'copy'; });

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

  /** 選択が「1本」または「リンクされた映像と音声の1組」なら、その代表クリップ（クリックしたもの優先、映像優先） */
  function soleClip() {
    const sel = P.clips.filter((c) => st.sel.has(c.id));
    if (sel.length === 1) return sel[0];
    if (sel.length > 1 && sel[0].link && sel.every((c) => c.link === sel[0].link)) {
      const p = st.primary && sel.find((c) => c.id === st.primary);
      return p || sel.find((c) => c.type !== 'audio') || sel[0];
    }
    return null;
  }
  function renderInspector() {
    let sel = P.clips.filter((c) => st.sel.has(c.id));
    if (!sel.length) { insp.innerHTML = projectInspector(); bindInspector(null); return; }
    const sole = soleClip();
    if (sole) sel = [sole];
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
    const TL = { video: ['ビデオクリップ', 'var(--c-video)'], image: ['画像クリップ', 'var(--c-image)'], audio: ['オーディオクリップ', 'var(--c-audio)'], telop: ['テロップ', 'var(--c-telop)'], shape: ['シェイプ', 'var(--c-shape)'], graphic: ['グラフィック（レイヤー）', 'var(--c-graphic)'] }[c.type];
    let h = `<div class="sec"><h4><span class="sw" style="background:${TL[1]}"></span>${TL[0]}</h4><div class="in">
      ${!['telop', 'shape', 'graphic'].includes(c.type) ? `<div class="note" style="word-break:break-all">${escapeHtml(m ? m.name : '素材なし')}${m && m.width ? ` ・ ${m.width}×${m.height}` : ''}</div>` : ''}
      ${field('開始', `<span class="unit" style="color:var(--ink2)">${tc(c.start)}</span>`)}
      ${field('長さ', scrub('dur', c.dur, { step: 1 / fps(), min: MIN_DUR, max: maxSourceDur(c) - (c.in || 0), unit: '秒', dec: 2 }))}
      ${c.type === 'video' || c.type === 'audio' ? field('素材の開始', `<span class="unit" style="color:var(--ink2)">${tc(c.in || 0)}</span>`) : ''}
      ${c.link ? `<div class="note">🔗 ${c.type === 'audio' ? '映像' : '音声'}（${partners(c).map((x) => x.track).join('・')}）とリンク中。一緒に動きます（Alt+クリックで片方だけ選択）</div>` : ''}
      ${c.type === 'video' && c.audioOff && !c.link ? '<div class="note">映像のみ（このクリップの音声は鳴りません）</div>' : ''}
      ${(c.type === 'video' && (c.link || (m && m.hasAudio))) || (c.type === 'audio' && c.link) ? `<div class="btnrow"><button class="btn sm" data-cmd="linkToggle">${c.link ? '🔗 リンク解除（別々に動かす）' : '映像と音声に分ける'}</button></div>` : ''}
    </div></div>`;
    if (c.type !== 'audio') h += easyMotionHtml(c);

    if (c.type === 'telop') {
      const d = designById.get(c.designId);
      const vs = d && d.variants && d.variants.length ? d.variants : [{ name: '標準' }];
      h += `<div class="sec"><h4>テキスト</h4><div class="in">
        <textarea id="t-text" rows="2" placeholder="テロップの文字（改行で2行）">${escapeHtml(c.text || '')}</textarea>
        ${d && d.sub ? `<input type="text" id="t-sub" placeholder="サブテキスト（肩書き・英字など）" value="${escapeHtml(c.sub || '')}">` : ''}
        <div class="note">デザイン：<b style="color:var(--ink)">${escapeHtml(d ? d.name : '不明')}</b>${d ? `（${escapeHtml((PACKS[d.pack] || {}).short || '')}）` : ''}</div>
        <div class="chips">${vs.map((v, i) => `<button class="chip${i === (c.variant || 0) ? ' on' : ''}" data-tv="${i}">${escapeHtml(v.name || '色' + (i + 1))}</button>`).join('')}</div>
        <div class="note">左の「テロップ」タブでデザインを選び「選択に適用」で入れ替えできます。</div>
        <div class="btnrow"><button class="btn sm primary" id="t-tographic" title="帯・文字・サブなどをレイヤーに分け、塗り・エッジ・影・テクスチャ・動きを個別に編集できるようにします">レイヤーに分解して細かく編集</button></div>
        ${isLocked(c.designId) ? '<div class="note" style="color:var(--warn)">製品版デザインです（書き出すと透かしが入ります）。<a href="#" data-cmd="unlock" style="color:var(--accent2)">解除コードを入力</a></div>' : ''}
      </div></div>`;
      h += `<div class="sec"><h4>アニメーション</h4><div class="in">
        ${field('登場', `<select id="t-anim">${[['none', 'なし'], ['pop', 'ポップ'], ['slideUp', '下からスライド'], ['slideLeft', '右からスライド'], ['wipe', 'ワイプ'], ['type', 'タイプライター']].map(([v, l]) => `<option value="${v}"${(c.anim || 'none') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${field('フェードイン', scrub('fadeIn', c.fadeIn || 0, { step: 0.05, min: 0, max: 5, unit: '秒', dec: 2 }))}
        ${field('フェードアウト', scrub('fadeOut', c.fadeOut || 0, { step: 0.05, min: 0, max: 5, unit: '秒', dec: 2 }))}
      </div></div>`;
    }
    if (c.type === 'graphic') h += graphicInspectorHtml(c);
    if (c.type === 'shape') {
      h += `<div class="sec"><h4>シェイプ</h4><div class="in">
        ${field('形', `<select id="sh-kind">${SHAPES.map(([v, l]) => `<option value="${v}"${c.shape === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${field('幅', scrub('w', c.w || 200, { step: 2, min: 2, max: 8000, unit: 'px' }))}
        ${field('高さ', scrub('h', c.h || 100, { step: 2, min: 2, max: 8000, unit: 'px' }))}
        ${c.shape === 'round' || c.shape === 'speech' ? field('角の丸み', scrub('radius', c.radius || 0, { step: 1, min: 0, max: 2000, unit: 'px' })) : ''}
        <label class="field" style="gap:6px;min-height:22px"><input type="checkbox" id="sh-fillon"${c.fillOn !== false ? ' checked' : ''}> 塗りつぶす</label>
        ${colorField('塗り', 'fill', c.fill || '#000000')}
        ${colorField('線', 'stroke', c.stroke || '#ffffff')}
        ${field('線の太さ', scrub('strokeW', c.strokeW || 0, { step: 1, min: 0, max: 200, unit: 'px' }))}
        ${recentRow()}
        <div class="btnrow"><button class="btn sm" data-shfit="w">横幅いっぱい</button><button class="btn sm" data-shfit="all">画面いっぱい</button></div>
        <div class="unit">シェイプのプリセット</div>${presetChips('shape')}
        <div class="btnrow"><button class="btn sm primary" id="ps-save-shape">＋ このシェイプを保存</button></div>
        <div class="note">不透明度は「モーション」で。テロップの後ろに敷く座布団は、シェイプのトラックをテロップより下に置きます（テロップは常に映像より手前）。</div>
      </div></div>`;
    }
    if (c.type === 'telop') {
      const d0 = designById.get(c.designId);
      const slots = d0 ? colorSlots(R.resolve(d0, c.variant || 0)) : [];
      if (slots.length) {
        h += `<div class="sec"><h4>テロップの色<button class="btn sm" id="tc-reset" style="margin-left:auto;padding:1px 6px">元の色に戻す</button></h4><div class="in">
          ${slots.map((x) => colorField(colorLabel(x.path), x.path, (c.colorOv && c.colorOv[x.path]) || x.value)).join('')}
          ${recentRow()}
          <div class="note">スポイトを押して画面のどこか（参考画像・ほかのアプリでも可）をクリックすると、その色を読み込みます。</div>
        </div></div>`;
      }
      h += `<div class="sec"><h4>テロップのプリセット</h4><div class="in">
        ${presetChips('telop')}
        <div class="btnrow"><button class="btn sm primary" id="ps-save-telop">＋ このテロップの見た目を保存</button></div>
        ${c.captionId ? '<div class="note">字幕から作ったテロップです。文字は「文字起こし」タブでも直せます（両方に反映）。</div>' : ''}
      </div></div>`;
    }
    if (c.type !== 'audio') {
      const kv = (pr) => kfValue(c, pr, clamp(st.time, c.start, clipEnd(c)));
      h += `<div class="sec"><h4>${c.type === 'graphic' ? 'グラフィック全体のモーション' : 'モーション'}<span class="unit" style="margin-left:auto;font-weight:400">◆＝キーフレーム</span></h4><div class="in">
        ${field('位置 X', scrub('x', kv('x'), { step: 1, unit: 'px' }) + kfBtn(c, 'x'))}
        ${field('位置 Y', scrub('y', kv('y'), { step: 1, unit: 'px' }) + kfBtn(c, 'y'))}
        ${field('スケール', scrub('scale', kv('scale'), { step: 1, min: 5, max: 800, unit: '%' }) + kfBtn(c, 'scale'))}
        ${field('回転', scrub('rotation', kv('rotation'), { step: 1, min: -3600, max: 3600, unit: '°' }) + kfBtn(c, 'rotation'))}
        ${field('不透明度', scrub('opacity', kv('opacity'), { step: 1, min: 0, max: 100, unit: '%' }) + kfBtn(c, 'opacity'))}
        ${!['telop', 'shape', 'graphic'].includes(c.type) ? field('フィット', `<select id="c-fit"><option value="native"${c.fit === 'native' ? ' selected' : ''}>原寸（横のときと同じ大きさ）</option><option value="contain"${c.fit === 'contain' ? ' selected' : ''}>全体を表示（余白あり）</option><option value="cover"${c.fit === 'cover' ? ' selected' : ''}>画面を埋める（はみ出しカット）</option><option value="stretch"${c.fit === 'stretch' ? ' selected' : ''}>引き伸ばす</option></select>`) : ''}
        <div class="btnrow"><button class="btn sm" id="c-reset">モーションをリセット</button></div>
        <div class="note">プログラムモニター上でドラッグして移動、四隅をドラッグで拡大縮小。◆ を押すと再生ヘッドの位置にキーフレームを打ち、以降の変更はその時刻の値になります。</div>
      </div></div>`;
      const fx = c.fx || {};
      h += `<div class="sec"><h4>演出プリセット<button class="btn sm" id="ps-reset" style="margin-left:auto;padding:1px 6px" title="初期のプリセットに戻す">初期化</button></h4><div class="in">
        ${presetChips('effect')}
        <div class="btnrow"><button class="btn sm" data-preset="punch">パンチイン（再生ヘッド）</button><button class="btn sm danger" data-preset="clear">演出を解除</button></div>
        <div class="btnrow"><button class="btn sm primary" id="ps-save-effect">＋ 今の設定をプリセットに保存</button></div>
        <div class="note">「⋯」で名前の変更・上書き・削除ができます。</div>
      </div></div>`;
      h += `<div class="sec"><h4>トランジション</h4><div class="in">
        ${field('入り', `<select id="tr-in">${TRANSITIONS.map(([v, l]) => `<option value="${v}"${((c.trIn || {}).type || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${field('入りの長さ', scrub('trIn.dur', (c.trIn || {}).dur || 0.3, { step: 0.05, min: 0.05, max: 3, unit: '秒', dec: 2 }))}
        ${field('出', `<select id="tr-out">${TRANSITIONS.map(([v, l]) => `<option value="${v}"${((c.trOut || {}).type || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${field('出の長さ', scrub('trOut.dur', (c.trOut || {}).dur || 0.3, { step: 0.05, min: 0.05, max: 3, unit: '秒', dec: 2 }))}
      </div></div>`;
      h += `<div class="sec"><h4>エフェクト（色・質感）</h4><div class="in">
        ${field('明るさ', scrub('fx.brightness', fx.brightness == null ? 100 : fx.brightness, { step: 1, min: 0, max: 300, unit: '%' }))}
        ${field('コントラスト', scrub('fx.contrast', fx.contrast == null ? 100 : fx.contrast, { step: 1, min: 0, max: 300, unit: '%' }))}
        ${field('彩度', scrub('fx.saturate', fx.saturate == null ? 100 : fx.saturate, { step: 1, min: 0, max: 300, unit: '%' }))}
        ${field('色相', scrub('fx.hue', fx.hue || 0, { step: 1, min: -180, max: 180, unit: '°' }))}
        ${field('モノクロ', scrub('fx.grayscale', fx.grayscale || 0, { step: 1, min: 0, max: 100, unit: '%' }))}
        ${field('セピア', scrub('fx.sepia', fx.sepia || 0, { step: 1, min: 0, max: 100, unit: '%' }))}
        ${field('ぼかし', scrub('fx.blur', fx.blur || 0, { step: 0.5, min: 0, max: 80, unit: 'px', dec: 1 }))}
        ${field('周辺減光', scrub('fx.vignette', fx.vignette || 0, { step: 1, min: 0, max: 100, unit: '%' }))}
        ${field('揺れ', scrub('fx.shake', fx.shake || 0, { step: 1, min: 0, max: 200, unit: 'px' }))}
        <div class="btnrow"><button class="btn sm" data-look="cinema">シネマ風</button><button class="btn sm" data-look="vivid">鮮やか</button><button class="btn sm" data-look="retro">レトロ</button><button class="btn sm" data-look="mono">モノクロ</button><button class="btn sm" data-look="none">元に戻す</button></div>
      </div></div>`;
    }
    if (c.type !== 'telop') {
      const noAudio = c.type === 'image' || c.type === 'shape' || c.type === 'graphic' || c.audioOff;
      h += `<div class="sec"><h4>${noAudio ? 'フェード' : '音声とフェード'}</h4><div class="in">
        ${!noAudio ? field('音量', scrub('volumeDb', c.volume <= 0.0001 ? -60 : 20 * Math.log10(c.volume == null ? 1 : c.volume), { step: 0.5, min: -60, max: 12, unit: 'dB', dec: 1 })) : ''}
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
    const counts = { video: 0, image: 0, audio: 0, telop: 0, shape: 0, graphic: 0 };
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

  function shortcutsHtml() {
    const ids = ['togglePlay', 'shuttleFwd', 'stepFwd', 'nextEdit', 'markIn', 'markOut', 'extract', 'rippleTrimPrev', 'rippleTrimNext', 'split', 'toolRazor', 'rippleDelete', 'undo', 'addTelop'];
    return `<div class="keys">${ids.map((id) => `<span>${keysHtml(id) || '—'}</span><span>${escapeHtml(ACTION_BY_ID.get(id)[1])}</span>`).join('')}</div>
      <button class="btn sm" data-cmd="shortcuts" style="margin-top:8px">すべてのショートカットを見る・変更する</button>`;
  }

  function kfBtn(c, prop) {
    const on = hasKf(c, prop);
    const lt = st.time - c.start;
    const here = on && c.kf[prop].some((k) => Math.abs(k[0] - lt) < 0.5 / fps());
    return `<button class="kfb${on ? ' on' : ''}${here ? ' here' : ''}" data-kf="${prop}" title="${on ? (here ? 'このキーフレームを削除' : '再生ヘッドにキーフレームを追加') : 'キーフレームを有効にする'}（右クリックで全キーフレーム削除）">${here ? '◆' : '◇'}</button>`;
  }
  const LOOKS = {
    cinema: { contrast: 115, saturate: 85, brightness: 95, vignette: 45, hue: 0, sepia: 0, grayscale: 0 },
    vivid: { contrast: 110, saturate: 140, brightness: 103, vignette: 0, hue: 0, sepia: 0, grayscale: 0 },
    retro: { contrast: 90, saturate: 80, brightness: 105, sepia: 35, vignette: 35, hue: -8, grayscale: 0 },
    mono: { grayscale: 100, contrast: 120, saturate: 100, brightness: 100, vignette: 25, sepia: 0, hue: 0 },
    none: { contrast: 100, saturate: 100, brightness: 100, vignette: 0, sepia: 0, grayscale: 0, hue: 0, blur: 0 },
  };
  function applyPreset(c, name) {
    const lt = clamp(st.time - c.start, 0, c.dur);
    const s0 = c.scale || 100;
    if (name === 'zoomIn') { c.kf = Object.assign(c.kf || {}, { scale: [[0, s0, 'easeInOut'], [c.dur, s0 * 1.15, 'easeInOut']] }); }
    if (name === 'kenburns') { c.kf = Object.assign(c.kf || {}, { scale: [[0, s0 * 1.08, 'linear'], [c.dur, s0 * 1.2, 'linear']], x: [[0, -40, 'linear'], [c.dur, 40, 'linear']] }); }
    if (name === 'punch') { const k = (c.kf && c.kf.scale) || [[0, s0, 'hold']]; k.forEach((x) => { x[2] = 'hold'; }); const at = Math.round(lt * fps()) / fps(); c.kf = Object.assign(c.kf || {}, { scale: k.filter((x) => x[0] < at - 1e-3).concat([[at, s0 * 1.25, 'hold']]) }); if (!c.kf.scale.length || c.kf.scale[0][0] > 0) c.kf.scale.unshift([0, s0, 'hold']); }
    if (name === 'shake') { c.fx = Object.assign(c.fx || {}, { shake: (c.fx && c.fx.shake) ? 0 : 14 }); }
    if (name === 'pop') { c.kf = Object.assign(c.kf || {}, { scale: [[0, s0 * 0.4, 'back'], [Math.min(0.3, c.dur / 2), s0, 'easeInOut']] }); }
    if (name === 'clear') { delete c.kf; delete c.fx; delete c.trIn; delete c.trOut; }
  }

  function setProp(c, prop, v) {
    if (prop === 'volumeDb') { c.volume = v <= -60 ? 0 : Math.pow(10, v / 20); return; }
    if (prop.startsWith('L.')) { const L = selectedLayer(c); if (L) setLayerProp(c, L, prop.slice(2), v); return; }
    if (KF_PROPS.includes(prop) && (hasKf(c, prop) || st.autoKey)) { setKf(c, prop, st.time - c.start, v); return; }
    if (prop.startsWith('fx.')) { c.fx = c.fx || {}; c.fx[prop.slice(3)] = v; return; }
    if (prop === 'trIn.dur' || prop === 'trOut.dur') { const k = prop.split('.')[0]; c[k] = c[k] || { type: '', dur: 0.3 }; c[k].dur = v; return; }
    if (prop === 'dur') { c.dur = snapFrame(Math.max(MIN_DUR, v)); return; }
    if (prop === 'w' || prop === 'h' || prop === 'radius' || prop === 'strokeW') { c[prop] = v; return; }
    c[prop] = v;
  }

  function bindInspector(sel) {
    // プロジェクト設定
    const asp = $('#p-aspect', insp);
    if (asp) asp.addEventListener('change', async () => {
      pushUndo();
      const a = ASPECTS[asp.value]; P.aspect = asp.value; P.width = a.w; P.height = a.h;
      telopCache.clear(); layoutMonitor(); changed({ props: true });
      // 向きの違う素材があれば、表示方法を聞く
      const mism = P.clips.filter((c) => (c.type === 'video' || c.type === 'image')).filter((c) => { const m = mediaMeta(c.mediaId); return m && m.width && m.height && m.width !== m.height && P.width !== P.height && (m.width > m.height) !== (P.width > P.height); });
      if (!mism.length) return;
      const m = openModal('向きの違う素材の表示', `
        <p>${P.width < P.height ? '縦の画面に横の素材' : '横の画面に縦の素材'}が ${mism.length} 個あります。どう表示しますか？（あとからクリップごとに「フィット」で変えられます）</p>
        <div class="aspects" style="grid-template-columns:1fr">
          <button data-fitopt="native" class="on"><b>原寸（おすすめ）</b><small>元の大きさのまま。はみ出した左右（上下）は切れます。位置はモニターでドラッグして調整</small></button>
          <button data-fitopt="cover"><b>画面を埋める</b><small>すき間なく拡大。切れる範囲が一番大きい</small></button>
          <button data-fitopt="contain"><b>全体を表示</b><small>全部見えるように縮小。上下（左右）に黒い帯</small></button>
        </div>`, [['そのまま', null], ['適用', 'go', true]]);
      let pick = 'native';
      $$('[data-fitopt]', m.el).forEach((b) => b.addEventListener('click', () => { pick = b.dataset.fitopt; $$('[data-fitopt]', m.el).forEach((x) => x.classList.toggle('on', x === b)); }));
      if (await m.result !== 'go') return;
      pushUndo();
      for (const c of mism) { c.fit = pick; c.x = 0; c.y = 0; }
      P.mismatchFit = pick;
      changed({ props: true });
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

    { const b = $('#t-tographic', insp); if (b) b.addEventListener('click', () => convertTelopToGraphic(c)); }
    const txt = $('#t-text', insp);
    if (txt) {
      txt.addEventListener('input', () => {
        pushUndo('text-' + c.id); c.text = txt.value;
        if (c.captionId) { const r = captions().find((x) => x.id === c.captionId); if (r) { r.text = txt.value.replace(/\n/g, ''); for (const o of P.clips) if (o !== c && o.captionId === r.id) { o.text = txt.value; telopCache.delete(o.id); } } }
        changed({ props: true, light: true });
      });
      txt.addEventListener('keydown', (e) => { if (e.key === 'Escape') txt.blur(); else if (!((e.ctrlKey || e.metaKey) && /^[sSmM]$/.test(e.key))) e.stopPropagation(); });
    }
    const sub = $('#t-sub', insp);
    if (sub) { sub.addEventListener('input', () => { pushUndo('sub-' + c.id); c.sub = sub.value; changed({ props: true, light: true }); }); sub.addEventListener('keydown', (e) => { if (e.key === 'Escape') sub.blur(); else if (!((e.ctrlKey || e.metaKey) && /^[sSmM]$/.test(e.key))) e.stopPropagation(); }); }
    $$('[data-tv]', insp).forEach((b) => b.addEventListener('click', () => { pushUndo(); c.variant = +b.dataset.tv; changed({ props: true }); }));
    const anim = $('#t-anim', insp);
    if (anim) anim.addEventListener('change', () => { pushUndo(); c.anim = anim.value; changed({ props: true }); const s = c.start; seek(s); });
    $$('[data-kf]', insp).forEach((b) => {
      const prop = b.dataset.kf;
      b.addEventListener('click', () => {
        pushUndo();
        const lt = clamp(st.time - c.start, 0, c.dur);
        if (!hasKf(c, prop)) { c.kf = c.kf || {}; c.kf[prop] = []; setKf(c, prop, lt, kfValue(c, prop, st.time)); if (lt > 0.01) { /* 先頭にも元の値を */ setKf(c, prop, 0, baseVal(c, prop)); } }
        else {
          const k = c.kf[prop], i = k.findIndex((x) => Math.abs(x[0] - lt) < 0.5 / fps());
          if (i >= 0) { k.splice(i, 1); if (!k.length) { c[prop] = baseVal(c, prop); delete c.kf[prop]; } }
          else setKf(c, prop, lt, kfValue(c, prop, st.time));
        }
        telopCache.delete(c.id); changed({ props: true });
      });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!hasKf(c, prop)) return; pushUndo(); c[prop] = kfValue(c, prop, st.time); delete c.kf[prop]; changed({ props: true }); });
    });
    $$('[data-papply]', insp).forEach((b) => b.addEventListener('click', () => { pushUndo(); applyPresetById(c, b.dataset.papply); telopCache.delete(c.id); changed({ props: true }); }));
    $$('[data-pmenu]', insp).forEach((b) => b.addEventListener('click', () => presetMenu(b.dataset.pmenu)));
    for (const k of ['effect', 'telop', 'shape']) { const b = $('#ps-save-' + k, insp); if (b) b.addEventListener('click', () => savePresetDialog(c, k)); }
    { const b = $('#ps-reset', insp); if (b) b.addEventListener('click', resetPresets); }
    $$('[data-preset]', insp).forEach((b) => b.addEventListener('click', () => { pushUndo(); applyPreset(c, b.dataset.preset); telopCache.delete(c.id); changed({ props: true }); }));
    $$('[data-look]', insp).forEach((b) => b.addEventListener('click', () => { pushUndo(); c.fx = Object.assign(c.fx || {}, LOOKS[b.dataset.look]); changed({ props: true }); }));
    for (const k of ['in', 'out']) {
      const sel = $('#tr-' + k, insp);
      if (sel) sel.addEventListener('change', () => { pushUndo(); const key = k === 'in' ? 'trIn' : 'trOut'; c[key] = Object.assign({ dur: 0.3 }, c[key] || {}, { type: sel.value }); if (!sel.value) delete c[key]; changed({ props: true }); });
    }
    if (c.type === 'graphic') bindGraphicInspector(c);
    bindEasyMotion(c);
    if (c.type === 'shape') {
      bindColorFields(insp, (k) => c[k], (k, v, final) => { pushUndo('color-' + k + c.id); c[k] = v; if (final) changed({ props: true, light: true }); else requestDraw(); });
      const kind = $('#sh-kind', insp); if (kind) kind.addEventListener('change', () => { pushUndo(); c.shape = kind.value; if (['ellipse', 'star', 'triangle'].includes(c.shape) && Math.max(c.w, c.h) / Math.max(1, Math.min(c.w, c.h)) > 2) { c.w = c.h = Math.round(Math.min(P.width, P.height) * 0.3); } if ((c.shape === 'line' || c.shape === 'arrow') && c.h > 80) c.h = 24; changed({ props: true }); });
      const fo = $('#sh-fillon', insp); if (fo) fo.addEventListener('change', () => { pushUndo(); c.fillOn = fo.checked; changed({ props: true, light: true }); });
      $$('[data-shfit]', insp).forEach((b) => b.addEventListener('click', () => { pushUndo(); c.w = P.width; c.x = 0; if (b.dataset.shfit === 'all') { c.h = P.height; c.y = 0; c.radius = 0; } c.scale = 100; changed({ props: true }); }));
    }
    if (c.type === 'telop') {
      const d0 = designById.get(c.designId);
      bindColorFields(insp, (k) => (c.colorOv && c.colorOv[k]) || (colorSlots(R.resolve(d0, c.variant || 0)).find((x) => x.path === k) || {}).value, (k, v, final) => {
        pushUndo('tcolor-' + k + c.id); c.colorOv = Object.assign({}, c.colorOv || {}, { [k]: v }); telopCache.delete(c.id);
        if (final) changed({ props: true, light: true }); else requestDraw();
      });
      const rs = $('#tc-reset', insp); if (rs) rs.addEventListener('click', () => { pushUndo(); delete c.colorOv; telopCache.delete(c.id); changed({ props: true }); });
    }
    const fit = $('#c-fit', insp);
    if (fit) fit.addEventListener('change', () => { pushUndo(); c.fit = fit.value; changed({ props: true }); });
    const rst = $('#c-reset', insp);
    if (rst) rst.addEventListener('click', () => { pushUndo(); c.x = 0; c.y = 0; c.scale = 100; c.opacity = 100; c.rotation = 0; delete c.kf; telopCache.delete(c.id); changed({ props: true }); });
  }
  function renderInspectorValues() {
    const sel = P.clips.filter((c) => st.sel.has(c.id));
    if (sel.length !== 1) return;
    const c = sel[0];
    $$('.scrub', insp).forEach((el) => {
      const p = el.dataset.prop, dec = +el.dataset.dec;
      if (p.startsWith('L.')) {
        const L = selectedLayer(c); if (!L) return;
        const path = p.slice(2);
        const v = KF_PROPS.includes(path) ? layerVal(L, path, clamp(st.time - c.start, 0, c.dur)) : getPath(L, path);
        if (v != null) el.textContent = (+(/\.stops\.\d+\.0$/.test(path) ? v * 100 : v)).toFixed(dec);
      } else if (KF_PROPS.includes(p)) el.textContent = (+kfValue(c, p, clamp(st.time, c.start, clipEnd(c)))).toFixed(dec);
      else if (p in c) el.textContent = (+c[p]).toFixed(dec);
    });
  }

  /* =================================================================
     イン／アウトと範囲カット（リフト・抽出・Q/W）
     ================================================================= */
  function inOut() {
    const a = P.inPoint, b = P.outPoint;
    if (a == null && b == null) return null;
    const s = a == null ? 0 : a, e = b == null ? duration() : b;
    return e - s >= 1 / fps() ? [s, e] : null;
  }
  function setMark(which, t) {
    pushUndo('mark');
    t = snapFrame(clamp(t, 0, Math.max(duration(), t)));
    if (which === 'in') { P.inPoint = t; if (P.outPoint != null && P.outPoint <= t) P.outPoint = null; }
    else { P.outPoint = t; if (P.inPoint != null && P.inPoint >= t) P.inPoint = null; }
    drawInOut(); drawRuler(); scheduleSave();
  }
  function drawInOut() {
    const el = $('#inout');
    const r = inOut();
    if (!r) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = `calc(var(--tl-head) + ${r[0] * st.pps}px)`;
    el.style.width = Math.max(1, (r[1] - r[0]) * st.pps) + 'px';
  }
  /** [a,b] の中身を全トラックから取り除く。ripple なら後ろを詰める */
  function removeRange(a, b, ripple, trackFilter) {
    a = snapFrame(a); b = snapFrame(b);
    if (b - a < 1 / fps() / 2) return 0;
    const len = b - a;
    const out = [], lm = new Map();
    for (const c of P.clips) {
      const tr = trackById(c.track);
      if (trackFilter && !trackFilter(tr)) { out.push(c); continue; }
      const s = c.start, e = clipEnd(c);
      if (e <= a + EPS || s >= b - EPS) { out.push(c); continue; }            // 範囲外
      if (s >= a - EPS && e <= b + EPS) continue;                              // 範囲内に収まる → 削除
      if (s < a && e > b) {                                                    // 範囲をまたぐ → 2つに
        const right = clone(c); right.id = uid('c');
        right.start = b; right.in = (c.in || 0) + (b - s); right.dur = e - b; right.fadeIn = 0;
        if (c.link) { if (!lm.has(c.link)) lm.set(c.link, uid('lk')); right.link = lm.get(c.link); }
        if (c.type === 'image' || c.type === 'telop') right.in = 0;
        c.dur = a - s; c.fadeOut = 0;
        out.push(c, right); continue;
      }
      if (s < a) { c.dur = a - s; c.fadeOut = 0; out.push(c); continue; }      // 後ろが削られる
      const cut = b - s;                                                       // 頭が削られる
      c.start = b; c.dur = e - b; c.fadeIn = 0;
      if (c.type === 'video' || c.type === 'audio') c.in = (c.in || 0) + cut;
      out.push(c);
    }
    if (ripple) for (const c of out) {
      if (trackFilter && !trackFilter(trackById(c.track))) continue;
      if (c.start >= b - EPS) c.start = snapFrame(c.start - len);
    }
    // 1フレームに満たない切れ端は消す
    P.clips = out.filter((c) => c.dur >= 1 / fps() - 1e-4);
    for (const id of Array.from(st.sel)) if (!clipById(id)) st.sel.delete(id);
    return len;
  }
  function liftOrExtract(ripple) {
    const r = inOut();
    if (!r) return toast('先にイン点（I）とアウト点（O）をマークしてください');
    pushUndo();
    const len = removeRange(r[0], r[1], ripple);
    if (ripple) { P.inPoint = null; P.outPoint = null; seek(r[0]); }
    changed({ structure: true }); drawInOut();
    toast(ripple ? `${len.toFixed(2)} 秒を抽出して詰めました` : `${len.toFixed(2)} 秒をリフトしました（すき間は残ります）`);
  }
  function rippleTrim(dir) {
    const t = snapFrame(st.time);
    const pts = editPoints();
    if (dir < 0) {
      const prev = pts.filter((x) => x < t - 1e-3).pop();
      if (prev == null) return toast('前に編集点がありません');
      pushUndo(); removeRange(prev, t, true); seek(prev);
    } else {
      const next = pts.find((x) => x > t + 1e-3);
      if (next == null) return toast('後ろに編集点がありません');
      pushUndo(); removeRange(t, next, true); seek(t);
    }
    changed({ structure: true });
  }
  function splitAll() {
    const t = st.time;
    const targets = P.clips.filter((c) => isActive(c, t));
    if (!targets.length) return toast('再生ヘッドの位置にクリップがありません');
    pushUndo();
    for (const c of targets) splitClipAt(c, t);
    changed({ structure: true });
  }
  function markClip() {
    const t = st.time;
    let c = P.clips.find((x) => st.sel.has(x.id) && isActive(x, t)) || P.clips.find((x) => st.sel.has(x.id));
    if (!c) {
      const order = P.tracks.filter((x) => x.kind === 'video').map((x) => x.id);
      c = P.clips.filter((x) => isActive(x, t)).sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track))[0];
    }
    if (!c) return toast('マークするクリップがありません');
    pushUndo('mark');
    P.inPoint = snapFrame(c.start); P.outPoint = snapFrame(clipEnd(c));
    drawInOut(); drawRuler(); scheduleSave();
  }

  /* =================================================================
     無料版／製品版（テロップの制限）
     ================================================================= */
  // 公開リポジトリなのでコードそのものは置かず、ハッシュだけを持つ
  const LICENSE_HASHES = ['cd8fc4721b8d02a39457a76641093fac40f7a8f2bbd2a338c8b8ffa8d71ea27a'];
  const LIC_LS = 'cc-license';
  const FREE_PER_PACK = 2;
  const freeDesigns = new Set();
  { const seen = {}; for (const d of DESIGNS) { const k = d.pack || 'tv-vol1'; seen[k] = (seen[k] || 0) + 1; if (seen[k] <= FREE_PER_PACK) freeDesigns.add(d.id); } }
  let licensed = false;
  async function checkStoredLicense() {
    try {
      const code = localStorage.getItem(LIC_LS);
      licensed = !!code && LICENSE_HASHES.includes(await hashCode(code));
      if (code && !licensed) localStorage.removeItem(LIC_LS);
    } catch (e) { licensed = false; }
  }
  async function unlockWithCode(code) {
    if (!LICENSE_HASHES.includes(await hashCode(code))) return false;
    try { localStorage.setItem(LIC_LS, String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')); } catch (e) { /* ignore */ }
    licensed = true; afterLicenseChange();
    return true;
  }
  function isLocked(designId) { return !licensed && !freeDesigns.has(designId) && !projectDesigns().some((d) => d.id === designId); }
  async function hashCode(code) {
    const norm = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('chain-cut:' + norm));
    return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  function updateLicenseBadge() {
    const b = $('#lic-badge');
    b.textContent = licensed ? '製品版' : '無料版';
    b.classList.toggle('pro', licensed);
    b.title = licensed ? 'すべてのテロップデザインが使えます' : `無料版：各パック ${FREE_PER_PACK} デザインまで。クリックで解除コードを入力`;
  }
  async function unlockDialog() {
    if (licensed) {
      const m = openModal('製品版', `<p class="big">製品版として登録済みです。</p><p>テロップ ${DESIGNS.length} デザインすべてを透かしなしで書き出せます。</p>`, [['このブラウザの登録を解除', 'off'], ['閉じる', null, true]]);
      if (await m.result === 'off') { try { localStorage.removeItem(LIC_LS); } catch (e) { /* ignore */ } licensed = false; afterLicenseChange(); }
      return false;
    }
    let m;
    const tryUnlock = async () => {
      if (await unlockWithCode($('#lic-code', m.el).value)) {
        m.close('ok');
        toast('製品版になりました。すべてのテロップが使えます');
      } else { $('#lic-msg', m.el).innerHTML = '<span style="color:var(--danger)">コードが正しくありません（ハイフンの有無・大文字小文字は問いません）</span>'; }
    };
    m = openModal('製品版の解除コードを入力', `
      <p>テロップ素材集（BASE）をご購入の方は、購入時にお届けした解除コードを入力すると、<b>${DESIGNS.length} デザインすべて</b>が使えるようになります。</p>
      <input type="text" id="lic-code" placeholder="CC-XXXX-XXXX-XXXX" style="font-size:16px;letter-spacing:.08em;text-transform:uppercase">
      <p id="lic-msg" class="note" style="min-height:20px"></p>
      <p class="note" style="font-size:11px;color:var(--muted)">無料版でも各パック ${FREE_PER_PACK} デザイン（計 ${freeDesigns.size} 種）と、編集・書き出しのすべての機能が使えます。製品版デザインも試しに置けますが、書き出すと透かしが入ります。<a href="../../shop/" target="_blank" style="color:var(--accent2)">テロップ素材集を見る →</a></p>
    `, [['キャンセル', null], ['解除する', tryUnlock, true]], { onEnter: tryUnlock });
    setTimeout(() => { const i = $('#lic-code', m.el); if (i) i.focus(); }, 30);
    return (await m.result) === 'ok';
  }
  function afterLicenseChange() { updateLicenseBadge(); telopCache.clear(); if (libGrid.children.length) renderLib(); requestDraw(); renderInspector(); }
  function drawSample(ctx, r) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    const fs = Math.max(18, Math.min(r.h * 0.35, 60));
    ctx.font = `900 ${fs}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.rotate(-0.12);
    ctx.lineWidth = fs / 6; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.strokeText('SAMPLE ・ 製品版デザイン', 0, 0); ctx.fillText('SAMPLE ・ 製品版デザイン', 0, 0);
    ctx.restore();
  }

  /* =================================================================
     文字起こし（ブラウザ内の Whisper）と字幕の編集
     P.captions = [{ id, mediaId, start, end, text }]
       mediaId あり → start/end は「素材の秒」（カットしても自動で追従）
       mediaId なし → start/end は「タイムラインの秒」（手入力した行など）
     ================================================================= */
  const ASR_MODELS = [
    ['Xenova/whisper-small', '高精度（初回 約250MB）'],
    ['Xenova/whisper-base', '速い（初回 約80MB・精度は控えめ）'],
  ];
  let asrWorker = null, asrBusy = false;
  const capPrefs = (() => { try { return Object.assign({ model: ASR_MODELS[0][0], maxChars: 16, auto: true }, JSON.parse(localStorage.getItem('cc-cap') || '{}')); } catch (e) { return { model: ASR_MODELS[0][0], maxChars: 16, auto: true }; } })();
  function saveCapPrefs() { try { localStorage.setItem('cc-cap', JSON.stringify(capPrefs)); } catch (e) { /* ignore */ } }
  function captions() { if (!Array.isArray(P.captions)) P.captions = []; return P.captions; }

  /** 字幕の行 → タイムライン上の出現位置（素材のどこを使っているかで決まる） */
  function captionSpans(row) {
    if (!row.mediaId) return [[row.start, row.end, null]];
    const out = [];
    for (const c of P.clips) {
      if (c.mediaId !== row.mediaId || (c.type !== 'video' && c.type !== 'audio')) continue;
      const a = Math.max(row.start, c.in || 0), b = Math.min(row.end, (c.in || 0) + c.dur);
      if (b - a < 0.15) continue;
      out.push([c.start + (a - (c.in || 0)), c.start + (b - (c.in || 0)), c]);
    }
    return out.sort((x, y) => x[0] - y[0]);
  }
  function sortedCaptions() {
    return captions().map((r) => ({ r, s: captionSpans(r) })).sort((a, b) => (a.s.length ? a.s[0][0] : 1e9 + a.r.start) - (b.s.length ? b.s[0][0] : 1e9 + b.r.start));
  }

  function renderCaptions() {
    const box = $('#cap-list'); if (!box) return;
    $('#cap-model').value = capPrefs.model;
    $('#cap-max').value = capPrefs.maxChars;
    $('#cap-auto').checked = capPrefs.auto;
    const rows = sortedCaptions();
    $('#cap-count').textContent = rows.length ? `${rows.length} 行` : '';
    if (!rows.length) {
      box.innerHTML = `<div class="empty-bin" style="margin:8px">まだ字幕がありません。<br><b>「文字起こし」</b>で声から自動で作るか、<br><b>「＋ 行を追加」</b>で自分で打ち込めます。</div>`;
      return;
    }
    const now = st.time;
    box.innerHTML = rows.map(({ r, s }) => {
      const t = s.length ? s[0][0] : null;
      const on = s.some(([a, b]) => now >= a && now < b);
      return `<div class="cap-row${on ? ' on' : ''}${t == null ? ' gone' : ''}" data-cap="${r.id}">
        <div class="cap-t"><button class="cap-tc" data-capgo="${r.id}" title="ここへ移動">${t == null ? 'カット済み' : tc(t).slice(3)}</button>
          <span class="cap-tools"><button data-capin="${r.id}" title="開始を再生ヘッドに">⇤</button><button data-capout="${r.id}" title="終了を再生ヘッドに">⇥</button><button data-capdel="${r.id}" title="この行を削除">×</button></span></div>
        <textarea class="cap-text" data-captext="${r.id}" rows="1" spellcheck="false">${escapeHtml(r.text)}</textarea></div>`;
    }).join('');
    $$('.cap-text', box).forEach(autoGrow);
  }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight + 2) + 'px'; }
  function highlightCaption() {
    if (st.ltab !== 'tx') return;
    const now = st.time;
    for (const el of $$('.cap-row', $('#cap-list'))) {
      const r = captions().find((x) => x.id === el.dataset.cap); if (!r) continue;
      const on = captionSpans(r).some(([a, b]) => now >= a && now < b);
      if (on !== el.classList.contains('on')) { el.classList.toggle('on', on); if (on && st.playing) el.scrollIntoView({ block: 'nearest' }); }
    }
  }

  /** 字幕テロップ（captionId 付き）の文字を行と同期 */
  function syncCaptionTelops(row) {
    for (const c of P.clips) if (c.captionId === row.id) { c.text = wrapCaption(row.text); telopCache.delete(c.id); }
  }
  function wrapCaption(text) {
    const max = capPrefs.maxChars || 16;
    const t = String(text).replace(/\s*\n\s*/g, '');
    if (t.length <= max || /\n/.test(text)) return String(text);
    // 真ん中に近い「自然な切れ目」で 2 行に（句読点 > 助詞の後 > ひらがな→漢字/カタカナ。語の途中は避ける）
    const arr = Array.from(t), mid = arr.length / 2;
    let best = Math.round(mid), bestScore = -1e9;
    for (let k = 2; k < arr.length - 1; k++) {
      const x = arr[k - 1], y = arr[k];
      let sc = -1e9;
      if (/[、。,.!?！？\s]/.test(x)) sc = 30;
      else if (/[はがをにでともへやの]/.test(x) && !/[ぁ-ん]/.test(y)) sc = 20;
      else if (/[ぁ-ん]/.test(x) && /[一-龥ァ-ヶ]/.test(y)) sc = 12;
      else if (/[一-龥]/.test(x) && /[ァ-ヶ]/.test(y)) sc = 6;
      if (sc < 0) continue;
      sc -= Math.abs(k - mid) * 2.2;
      if (sc > bestScore) { bestScore = sc; best = k; }
    }
    return arr.slice(0, best).join('').trim() + '\n' + arr.slice(best).join('').trim();
  }

  /** 長すぎる行を、句読点・文字数で分ける（時間は文字数で按分） */
  function splitLongRows() {
    const max = capPrefs.maxChars || 16, out = [];
    let n = 0;
    for (const r of captions()) {
      const t = r.text.replace(/\s+/g, ' ').trim();
      if (t.length <= max * 2) { out.push(r); continue; }
      const parts = [];
      let cur = '';
      const chars = Array.from(t);
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        cur += ch;
        if ((/[。！？!?]/.test(ch) && cur.length >= max * 0.5) || (/[、,\s]/.test(ch) && cur.length >= max)) { parts.push(cur.trim()); cur = ''; continue; }
        if (cur.length >= max * 1.6) {
          // 句読点がないときは、助詞の後ろなど自然な所で切る（カタカナ語・漢字語の途中では切らない）
          const arr = Array.from(cur);
          let cut = -1;
          for (let k = arr.length - 1; k >= Math.max(3, arr.length - 10); k--) {
            const a = arr[k - 1], b = arr[k];
            if (/[はがをにでともへやの]/.test(a) && !/[ぁ-ん]/.test(b)) { cut = k; break; }
            if (/[ぁ-ん]/.test(a) && /[一-龥ァ-ヶー]/.test(b)) { cut = k; break; }
          }
          if (cut < 0 && cur.length < max * 2) continue;
          if (cut < 0) cut = arr.length - 1;
          parts.push(arr.slice(0, cut).join('').trim()); cur = arr.slice(cut).join('');
        }
      }
      if (cur.trim()) { if (parts.length && cur.trim().length < 4) parts[parts.length - 1] += cur.trim(); else parts.push(cur.trim()); }
      const total = parts.reduce((s, p) => s + p.length, 0) || 1;
      let a = r.start;
      parts.forEach((p, i) => {
        const b = i === parts.length - 1 ? r.end : a + (r.end - r.start) * p.length / total;
        out.push({ id: uid('cap'), mediaId: r.mediaId, start: a, end: b, text: p });
        a = b;
      });
      n++;
    }
    P.captions = out;
    return n;
  }

  /** 字幕 → テロップ（以前に作った字幕テロップは作り直す） */
  function captionsToTelops(silent) {
    const rows = captions();
    if (!rows.length) return toast('字幕がありません');
    const designId = (st.libDesign && designById.has(st.libDesign)) ? st.libDesign : (P.captionDesign && designById.has(P.captionDesign) ? P.captionDesign : null);
    pushUndo();
    // 使うトラック：前回の字幕テロップがあればそこ、なければ空いている映像トラック（V1 以外）、なければ新規
    const prev = P.clips.find((c) => c.captionId);
    let tid = prev ? prev.track : null;
    P.clips = P.clips.filter((c) => !c.captionId);
    if (!tid || !trackById(tid)) {
      const free = P.tracks.filter((t) => t.kind === 'video' && t.id !== 'V1').find((t) => !P.clips.some((c) => c.track === t.id));
      tid = (free || addTrack('video', true)).id;
    }
    const savedDesign = st.libDesign, savedVariant = st.libVariant;
    if (designId) { st.libDesign = designId; P.captionDesign = designId; }
    let n = 0;
    for (const { r, s } of sortedCaptions()) {
      if (!r.text.trim()) continue; // 空の行はテロップにしない
      for (const [a, b] of s) {
        const c = makeTelopClip(tid, a, wrapCaption(r.text), Math.max(0.3, b - a));
        c.captionId = r.id; c.fadeIn = 0.05; c.fadeOut = 0.05;
        if (P.captionPreset) applyTelopPresetData(c, P.captionPreset);
        P.clips.push(c); n++;
      }
    }
    st.libDesign = savedDesign; st.libVariant = savedVariant;
    // 重なる字幕テロップは、前のものを次の開始で終わらせる
    const caps = P.clips.filter((c) => c.captionId && c.track === tid).sort((x, y) => x.start - y.start);
    for (let i = 0; i < caps.length - 1; i++) if (clipEnd(caps[i]) > caps[i + 1].start) caps[i].dur = Math.max(0.2, snapFrame(caps[i + 1].start - caps[i].start));
    changed({ structure: true });
    if (!silent) toast(`字幕 ${n} 枚をテロップにしました（${tid}）。文字を直すと、テロップにもそのまま反映されます`);
  }

  /** 16kHz モノラルに */
  async function toMono16k(buf, a, b) {
    const len = Math.max(1, Math.ceil((b - a) * 16000));
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oc = new OAC(1, len, 16000);
    const src = oc.createBufferSource(); src.buffer = buf; src.connect(oc.destination);
    src.start(0, a, b - a);
    const r = await oc.startRendering();
    return r.getChannelData(0).slice();
  }
  /** 25 秒前後で、静かな所を選んで区切る */
  function chunkPoints(x, maxLen) {
    const sr = 16000, out = [0], win = sr * 0.05;
    let pos = 0;
    while (x.length - pos > maxLen * sr) {
      const from = pos + Math.floor(maxLen * 0.7 * sr), to = pos + maxLen * sr;
      let best = to, bestE = Infinity;
      for (let i = from; i + win < to; i += win) {
        let e = 0; for (let j = i; j < i + win; j += 4) e += x[j] * x[j];
        if (e < bestE) { bestE = e; best = i + win / 2; }
      }
      pos = Math.floor(best); out.push(pos);
    }
    out.push(x.length);
    return out;
  }
  function runAsr(audio, model, device) {
    return new Promise((resolve, reject) => {
      const id = uid('asr');
      const on = (e) => {
        const m = e.data;
        if (m.type === 'progress') { onAsrProgress(m); return; }
        if (m.id !== id) return;
        asrWorker.removeEventListener('message', on);
        if (m.type === 'result') resolve(m.chunks); else reject(new Error(m.message));
      };
      asrWorker.addEventListener('message', on);
      asrWorker.postMessage({ type: 'run', id, audio, model, lang: 'japanese', device }, [audio.buffer]);
    });
  }
  const dlProgress = {};
  function onAsrProgress(m) {
    const s = $('#cap-status'); if (!s) return;
    if (m.stage === 'load' && m.file && m.total) {
      dlProgress[m.file] = [m.loaded || 0, m.total];
      const tot = Object.values(dlProgress).reduce((a, [l, t]) => [a[0] + l, a[1] + t], [0, 0]);
      s.textContent = `音声認識モデルを準備中… ${(tot[0] / 1048576).toFixed(0)} / ${(tot[1] / 1048576).toFixed(0)} MB（初回だけ）`;
      setCapBar(tot[0] / tot[1] * 0.3);
    } else if (m.stage === 'fallback') s.textContent = 'GPU が使えないため CPU で処理します（少し時間がかかります）';
  }
  function setCapBar(p) { const b = $('#cap-bar'); if (b) { b.parentElement.style.display = 'block'; b.style.width = (clamp(p, 0, 1) * 100).toFixed(1) + '%'; } }

  async function transcribe() {
    if (asrBusy) return;
    // 対象：選択中の動画・音声クリップ、なければ V1 の動画（なければ音声のあるクリップ全部）
    let targets = withPartners(P.clips.filter((c) => st.sel.has(c.id))).filter(hasSound);
    if (!targets.length) targets = P.clips.filter((c) => c.track === 'V1' && c.type === 'video' && (mediaMeta(c.mediaId) || {}).hasAudio);
    if (!targets.length) targets = P.clips.filter((c) => hasSound(c) && !/^SE_/.test((mediaMeta(c.mediaId) || {}).name || ''));
    if (!targets.length) return toast('声の入った動画・音声クリップがありません。先にタイムラインに置いてください', true);
    // 素材ごとに、使っている範囲をまとめる
    const ranges = {};
    for (const c of targets) (ranges[c.mediaId] = ranges[c.mediaId] || []).push([Math.max(0, (c.in || 0) - 0.3), (c.in || 0) + c.dur + 0.3]);
    for (const k of Object.keys(ranges)) {
      const r = ranges[k].sort((a, b) => a[0] - b[0]), m = [];
      for (const x of r) { if (m.length && x[0] <= m[m.length - 1][1] + 1) m[m.length - 1][1] = Math.max(m[m.length - 1][1], x[1]); else m.push(x.slice()); }
      ranges[k] = m;
    }
    const totalSec = Object.values(ranges).flat().reduce((s, [a, b]) => s + b - a, 0);
    asrBusy = true;
    const btn = $('#cap-run'); btn.disabled = true; btn.textContent = '文字起こし中…';
    const status = $('#cap-status');
    status.textContent = '準備中…'; setCapBar(0.02);
    const t0 = performance.now();
    try {
      if (!asrWorker) asrWorker = new Worker('asr-worker.js', { type: 'module' });
      let device = 'wasm';
      try { if (navigator.gpu && await navigator.gpu.requestAdapter()) device = 'webgpu'; } catch (e) { device = 'wasm'; }
      const rows = [];
      let done = 0;
      for (const [mediaId, list] of Object.entries(ranges)) {
        const buf = await getBuffer(mediaId);
        if (!buf) continue;
        for (const [a0, b0] of list) {
          const a = Math.max(0, a0), b = Math.min(buf.duration, b0);
          const x = await toMono16k(buf, a, b);
          const pts = chunkPoints(x, 28);
          for (let i = 0; i < pts.length - 1; i++) {
            const piece = x.slice(pts[i], pts[i + 1]);
            const off = a + pts[i] / 16000;
            status.textContent = `文字起こし中… ${Math.round(done)} / ${Math.round(totalSec)} 秒`;
            const chunks = await runAsr(piece, capPrefs.model, device);
            for (const ch of chunks) {
              const text = String(ch.text || '').trim();
              if (!text || /^[\s.。、…♪]*$/.test(text)) continue;
              const ts = ch.timestamp || [0, piece.length / 16000];
              const s = off + (ts[0] || 0), e = off + (ts[1] != null ? ts[1] : piece.length / 16000);
              rows.push({ id: uid('cap'), mediaId, start: s, end: Math.max(s + 0.3, e), text });
            }
            done += piece.length / 16000;
            setCapBar(0.3 + 0.7 * done / Math.max(1, totalSec));
          }
        }
      }
      pushUndo();
      // 同じ範囲の古い字幕は置き換える
      P.captions = captions().filter((r) => !(r.mediaId && ranges[r.mediaId] && ranges[r.mediaId].some(([a, b]) => r.start >= a - 0.01 && r.end <= b + 0.01)));
      P.captions.push(...rows);
      const split = splitLongRows();
      const secs = ((performance.now() - t0) / 1000).toFixed(0);
      status.textContent = `完了：${rows.length} 行（${secs} 秒）${split ? `・長い行を ${split} か所分割` : ''}。文字はそのまま直せます`;
      setCapBar(1);
      if (capPrefs.auto) captionsToTelops(true);
      changed({ structure: true });
      renderCaptions();
    } catch (e) {
      console.error(e);
      status.textContent = '文字起こしに失敗しました：' + (e.message || e);
      toast('文字起こしに失敗しました。ネット接続（初回はモデルのダウンロードが必要）を確認してください', true);
    } finally {
      asrBusy = false; btn.disabled = false; btn.textContent = '文字起こし';
      setTimeout(() => { const b = $('#cap-bar'); if (b && !asrBusy) b.parentElement.style.display = 'none'; }, 4000);
    }
  }

  function addCaptionRow() {
    // 再生ヘッドの位置にある音声つきクリップに結びつける（カットしても追従するように）
    const t = st.time;
    const c = P.clips.filter((x) => hasSound(x) && isActive(x, t))
      .sort((a, b) => (a.track === 'V1' ? -1 : 0) - (b.track === 'V1' ? -1 : 0))[0];
    pushUndo();
    const row = c ? { id: uid('cap'), mediaId: c.mediaId, start: (c.in || 0) + (t - c.start), end: (c.in || 0) + Math.min(c.dur, t - c.start + 2), text: '' }
      : { id: uid('cap'), mediaId: null, start: t, end: t + 2, text: '' };
    captions().push(row);
    scheduleSave();
    renderCaptions();
    setTimeout(() => { const ta = $(`[data-captext="${row.id}"]`); if (ta) { ta.focus(); ta.scrollIntoView({ block: 'nearest' }); } }, 20);
  }
  function setRowEdge(id, which) {
    const r = captions().find((x) => x.id === id); if (!r) return;
    pushUndo();
    let v = st.time;
    if (r.mediaId) {
      const c = P.clips.find((x) => x.mediaId === r.mediaId && isActive(x, st.time));
      if (!c) return toast('再生ヘッドがこの素材の上にありません');
      v = (c.in || 0) + (st.time - c.start);
    }
    if (which === 'in') r.start = Math.min(v, r.end - 0.2); else r.end = Math.max(v, r.start + 0.2);
    // 字幕テロップの位置も合わせる
    if (P.clips.some((c) => c.captionId === r.id)) { const keep = P.clips.filter((c) => c.captionId === r.id)[0]; const sp = captionSpans(r); P.clips.filter((c) => c.captionId === r.id).forEach((c, i) => { if (sp[i]) { c.start = snapFrame(sp[i][0]); c.dur = snapFrame(Math.max(0.3, sp[i][1] - sp[i][0])); } }); void keep; }
    changed({ structure: true }); renderCaptions();
  }

  // パネルの操作
  $('#cap-run').addEventListener('click', transcribe);
  $('#cap-add').addEventListener('click', addCaptionRow);
  $('#cap-telop').addEventListener('click', () => captionsToTelops());
  $('#cap-split').addEventListener('click', () => { pushUndo(); const n = splitLongRows(); scheduleSave(); renderCaptions(); toast(n ? `${n} 行を分割しました` : '分割が必要な長い行はありません'); });
  $('#cap-clear').addEventListener('click', () => {
    if (!captions().length) return;
    if (!confirm('字幕をすべて削除しますか？（字幕から作ったテロップも消えます）')) return;
    pushUndo(); P.captions = []; P.clips = P.clips.filter((c) => !c.captionId); changed({ structure: true }); renderCaptions();
  });
  $('#cap-srt').addEventListener('click', () => {
    const rows = sortedCaptions().filter((x) => x.s.length);
    if (!rows.length) return toast('書き出せる字幕がありません');
    const f = (t) => { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
    let n = 0;
    const srt = rows.flatMap(({ r, s }) => s.map(([a, b]) => `${++n}\n${f(a)} --> ${f(b)}\n${wrapCaption(r.text)}\n`)).join('\n');
    downloadBlob(new Blob(['﻿' + srt], { type: 'text/plain' }), safeName(P.name || 'captions') + '.srt');
  });
  $('#cap-model').innerHTML = ASR_MODELS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#cap-model').addEventListener('change', (e) => { capPrefs.model = e.target.value; saveCapPrefs(); });
  $('#cap-max').addEventListener('change', (e) => { capPrefs.maxChars = clamp(+e.target.value || 16, 6, 40); saveCapPrefs(); });
  $('#cap-auto').addEventListener('change', (e) => { capPrefs.auto = e.target.checked; saveCapPrefs(); });
  $('#cap-list').addEventListener('input', (e) => {
    const ta = e.target.closest('[data-captext]'); if (!ta) return;
    const r = captions().find((x) => x.id === ta.dataset.captext); if (!r) return;
    pushUndo('cap-' + r.id);
    r.text = ta.value; autoGrow(ta);
    syncCaptionTelops(r);
    scheduleSave(); requestDraw(); renderTimelineSoon();
  });
  $('#cap-list').addEventListener('keydown', (e) => {
    const ta = e.target.closest('[data-captext]'); if (!ta) return;
    e.stopPropagation();
    if (e.key === 'Escape') ta.blur();
    if (e.key === 'Enter' && !e.shiftKey) { // Enter で次の行へ（Shift+Enter で改行）
      e.preventDefault();
      const all = $$('[data-captext]', $('#cap-list')); const i = all.indexOf(ta);
      if (all[i + 1]) all[i + 1].focus(); else addCaptionRow();
    }
  });
  $('#cap-list').addEventListener('focusin', (e) => {
    const ta = e.target.closest('[data-captext]'); if (!ta) return;
    const r = captions().find((x) => x.id === ta.dataset.captext); if (!r) return;
    const sp = captionSpans(r); if (sp.length && !st.playing) seek(sp[0][0] + 0.01);
  });
  $('#cap-list').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.capgo) { const r = captions().find((x) => x.id === b.dataset.capgo); const sp = r && captionSpans(r); if (sp && sp.length) { seek(sp[0][0] + 0.01); followPlayhead(); } }
    if (b.dataset.capin) setRowEdge(b.dataset.capin, 'in');
    if (b.dataset.capout) setRowEdge(b.dataset.capout, 'out');
    if (b.dataset.capdel) { pushUndo(); const id = b.dataset.capdel; P.captions = captions().filter((x) => x.id !== id); P.clips = P.clips.filter((c) => c.captionId !== id); changed({ structure: true }); renderCaptions(); }
  });
  let tlSoon = 0;
  function renderTimelineSoon() { clearTimeout(tlSoon); tlSoon = setTimeout(renderTimeline, 250); }

  /* =================================================================
     プリセット（演出・テロップ）— 追加・名前変更・上書き・削除ができる
     このブラウザに保存（localStorage）。キーフレームの時刻はクリップの長さに対する割合で持つ
     ================================================================= */
  const PRESET_LS = 'cc-presets';
  const rel = (kf, dur) => (kf ? Object.fromEntries(Object.entries(kf).map(([k, arr]) => [k, arr.map(([t, v, e]) => [+(t / Math.max(dur, 1e-3)).toFixed(4), v, e])])) : undefined);
  const DEFAULT_PRESETS = [
    { id: 'p-zoomin', kind: 'effect', name: 'じわっとズーム', data: { kfRel: { scale: [[0, 100, 'easeInOut'], [1, 115, 'easeInOut']] } } },
    { id: 'p-kenburns', kind: 'effect', name: 'ケンバーンズ', data: { kfRel: { scale: [[0, 108, 'linear'], [1, 120, 'linear']], x: [[0, -40, 'linear'], [1, 40, 'linear']] } } },
    { id: 'p-zoomout', kind: 'effect', name: 'ゆっくり引く', data: { kfRel: { scale: [[0, 118, 'easeOut'], [1, 100, 'easeOut']] } } },
    { id: 'p-shake', kind: 'effect', name: '揺れ', data: { fx: { shake: 14 } } },
    { id: 'p-pop', kind: 'effect', name: 'ポンと出る', data: { kfAbs: { scale: [[0, 40, 'back'], [0.3, 100, 'easeInOut']] } } },
    { id: 'p-flashin', kind: 'effect', name: 'フラッシュで入る', data: { trIn: { type: 'flash', dur: 0.25 } } },
    { id: 'p-whip', kind: 'effect', name: 'ホイップで入る', data: { trIn: { type: 'whip', dur: 0.3 } } },
    { id: 'p-cinema', kind: 'effect', name: 'シネマ風', data: { fx: { contrast: 115, saturate: 85, brightness: 95, vignette: 45 } } },
    { id: 'pt-pop', kind: 'telop', name: 'ポップに出る', data: { anim: 'pop', fadeIn: 0.05, fadeOut: 0.1 } },
    { id: 'pt-slide', kind: 'telop', name: '下からスライド', data: { anim: 'slideUp', fadeIn: 0.1, fadeOut: 0.15 } },
    { id: 'pt-type', kind: 'telop', name: 'タイプライター', data: { anim: 'type', fadeIn: 0, fadeOut: 0.1 } },
  ];
  function loadPresets() {
    try { const v = JSON.parse(localStorage.getItem(PRESET_LS) || 'null'); if (Array.isArray(v)) return v; } catch (e) { /* ignore */ }
    return JSON.parse(JSON.stringify(DEFAULT_PRESETS));
  }
  let presets = loadPresets();
  function savePresets() { try { localStorage.setItem(PRESET_LS, JSON.stringify(presets)); } catch (e) { /* ignore */ } }

  /** 今のクリップの設定 → プリセットのデータ */
  function captureClip(c, kind) {
    const d = {};
    if (c.kf && Object.keys(c.kf).length) d.kfRel = rel(c.kf, c.dur);
    if (c.fx && Object.keys(c.fx).length) d.fx = clone(c.fx);
    if (c.trIn && c.trIn.type) d.trIn = clone(c.trIn);
    if (c.trOut && c.trOut.type) d.trOut = clone(c.trOut);
    for (const k of ['scale', 'x', 'y', 'rotation', 'opacity']) if (c[k] != null && c[k] !== KF_DEFAULT[k]) d[k] = c[k];
    if (kind === 'telop') {
      Object.assign(d, { designId: c.designId, variant: c.variant || 0, anim: c.anim || 'none', fadeIn: c.fadeIn, fadeOut: c.fadeOut });
      if (c.colorOv) d.colorOv = clone(c.colorOv);
      const pd = projectDesigns().find((x) => x.id === c.designId);
      if (pd) d.design = clone(pd); // 独自デザインは中身ごと持ち運ぶ
    } else if (c.type === 'shape') { Object.assign(d, { shape: c.shape, w: c.w, h: c.h, radius: c.radius, fill: c.fill, fillOn: c.fillOn, stroke: c.stroke, strokeW: c.strokeW }); } else if (c.type !== 'audio') { d.fit = c.fit; }
    return d;
  }
  function applyEffectPresetData(c, d) {
    if (d.kfRel) { c.kf = c.kf || {}; for (const [k, arr] of Object.entries(d.kfRel)) c.kf[k] = arr.map(([t, v, e]) => [Math.round(t * c.dur * fps()) / fps(), k === 'scale' ? v * (c.scale || 100) / 100 : v, e]); }
    if (d.kfAbs) { c.kf = c.kf || {}; for (const [k, arr] of Object.entries(d.kfAbs)) c.kf[k] = arr.map(([t, v, e]) => [Math.min(c.dur, t), k === 'scale' ? v * (c.scale || 100) / 100 : v, e]); }
    if (d.fx) c.fx = Object.assign(c.fx || {}, clone(d.fx));
    if (d.trIn) c.trIn = clone(d.trIn);
    if (d.trOut) c.trOut = clone(d.trOut);
    for (const k of ['scale', 'x', 'y', 'rotation', 'opacity', 'fit']) if (d[k] != null && !(d.kfRel && d.kfRel[k])) c[k] = d[k];
    if (c.type === 'shape') for (const k of ['shape', 'w', 'h', 'radius', 'fill', 'fillOn', 'stroke', 'strokeW']) if (d[k] != null) c[k] = d[k];
  }
  function applyTelopPresetData(c, d) {
    if (d.design && !designById.has(d.design.id)) { P.designs = projectDesigns().concat([clone(d.design)]); registerProjectDesigns(); }
    if (d.designId && designById.has(d.designId)) c.designId = d.designId;
    for (const k of ['variant', 'anim', 'fadeIn', 'fadeOut']) if (d[k] != null) c[k] = d[k];
    if (d.colorOv) c.colorOv = clone(d.colorOv);
    applyEffectPresetData(c, d);
    telopCache.delete(c.id);
  }
  function applyPresetById(c, id) {
    const p = presets.find((x) => x.id === id); if (!p) return;
    if (p.kind === 'telop') { if (c.type === 'telop') applyTelopPresetData(c, p.data); }
    else if (p.kind === 'shape') { if (c.type === 'shape') applyEffectPresetData(c, p.data); }
    else applyEffectPresetData(c, p.data);
  }
  function presetChips(kind) {
    const list = presets.filter((p) => p.kind === kind);
    return `<div class="pchips">${list.map((p) => `<span class="pchip"><button class="pc-apply" data-papply="${p.id}" title="適用">${escapeHtml(p.name)}</button><button class="pc-menu" data-pmenu="${p.id}" title="名前変更・上書き・削除">⋯</button></span>`).join('') || '<span class="unit">まだありません</span>'}</div>`;
  }
  async function savePresetDialog(c, kind) {
    const same = presets.filter((p) => p.kind === kind);
    const m = openModal(kind === 'telop' ? 'テロップのプリセットとして保存' : kind === 'shape' ? 'シェイプのプリセットとして保存' : '演出のプリセットとして保存', `
      <p>今のクリップの${kind === 'telop' ? 'デザイン・色・アニメーション・位置・大きさ' : kind === 'shape' ? '形・大きさ・色・線・動き' : '動き（キーフレーム）・エフェクト・トランジション・位置・大きさ'}を保存します。保存したプリセットは、どのプロジェクトでもボタン一つで使えます。</p>
      ${field('保存先', `<select id="ps-target"><option value="">新しいプリセット</option>${same.map((p) => `<option value="${p.id}">上書き：${escapeHtml(p.name)}</option>`).join('')}</select>`)}
      ${field('名前', '<input type="text" id="ps-name" placeholder="例：強調ドン、商品紹介ズーム">')}
    `, [['キャンセル', null], ['保存', 'go', true]]);
    const tgt = $('#ps-target', m.el), nm = $('#ps-name', m.el);
    tgt.addEventListener('change', () => { const p = presets.find((x) => x.id === tgt.value); nm.value = p ? p.name : ''; });
    setTimeout(() => nm.focus(), 30);
    if (await m.result !== 'go') return;
    const name = nm.value.trim() || (kind === 'telop' ? 'マイテロップ' : 'マイ演出');
    const data = captureClip(c, kind);
    const ex = presets.find((x) => x.id === tgt.value);
    if (ex) { ex.name = name; ex.data = data; } else presets.push({ id: uid('pr'), kind, name, data });
    savePresets(); renderInspector(); renderLibPresets();
    toast(`プリセット「${name}」を保存しました`);
  }
  async function presetMenu(id) {
    const p = presets.find((x) => x.id === id); if (!p) return;
    const c = P.clips.find((x) => st.sel.has(x.id));
    const m = openModal(`プリセット「${escapeHtml(p.name)}」`, `
      ${field('名前', `<input type="text" id="pm-name" value="${escapeHtml(p.name)}">`)}
      <p class="note" style="font-size:11px;color:var(--muted)">中身を変えたいときは、クリップに適用 → インスペクターで調整 → 「上書き」で保存し直します。</p>
    `, [['削除', 'del'], ...(c ? [['選択中のクリップの設定で上書き', 'over']] : []), ['キャンセル', null], ['名前を保存', 'name', true]]);
    const r = await m.result;
    if (r === 'del') { if (!confirm(`「${p.name}」を削除しますか？`)) return; presets = presets.filter((x) => x.id !== id); }
    else if (r === 'name') { p.name = $('#pm-name', m.el).value.trim() || p.name; }
    else if (r === 'over' && c) { p.data = captureClip(c, p.kind); p.name = $('#pm-name', m.el).value.trim() || p.name; toast(`「${p.name}」を上書きしました`); }
    else return;
    savePresets(); renderInspector(); renderLibPresets();
  }
  function resetPresets() {
    if (!confirm('プリセットを初期状態に戻しますか？（自分で作ったものは消えます）')) return;
    presets = JSON.parse(JSON.stringify(DEFAULT_PRESETS)); savePresets(); renderInspector(); renderLibPresets();
  }
  /** テロップタブの「マイプリセット」：押すと再生ヘッドにそのテロップを追加 */
  function renderLibPresets() {
    const box = $('#lib-presets'); if (!box) return;
    const list = presets.filter((p) => p.kind === 'telop' && p.data.designId);
    box.innerHTML = list.length ? `<div class="unit" style="margin-bottom:3px">マイプリセット（押すと再生ヘッドに追加）</div>` + list.map((p) => `<button class="chip" data-libpreset="${p.id}">${escapeHtml(p.name)}</button>`).join(' ') : '';
  }
  $('#lib-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-libpreset]'); if (!b) return;
    const p = presets.find((x) => x.id === b.dataset.libpreset); if (!p) return;
    pushUndo();
    const start = st.time;
    const tr = freeVideoTrack(start, 3);
    const c = makeTelopClip(tr.id, start);
    applyTelopPresetData(c, p.data);
    const d = designById.get(c.designId); if (d && d.sample) c.text = d.sample;
    P.clips.push(c); st.sel = new Set([c.id]);
    changed({ structure: true });
    setTimeout(() => { const ta = $('#t-text'); if (ta) { ta.focus(); ta.select(); } }, 30);
  });

  /* =================================================================
     シェイプ
     ================================================================= */
  const SHAPES = [['rect', '四角'], ['round', '角丸'], ['ellipse', '丸'], ['triangle', '三角'], ['star', '星'], ['line', '線'], ['arrow', '矢印'], ['speech', '吹き出し']];
  const SHAPE_NAME = Object.fromEntries(SHAPES);
  function makeShapeClip(track, start, kind) {
    const c = baseClip('shape', track, start, 3);
    const tall = P.height > P.width;
    Object.assign(c, {
      shape: kind || 'round', w: Math.round(P.width * (tall ? 0.8 : 0.5)), h: Math.round(P.height * (tall ? 0.08 : 0.14)),
      fill: '#000000', fillOn: true, stroke: '#ffffff', strokeW: 0, radius: 24, opacity: 70, fadeIn: 0.1, fadeOut: 0.1,
    });
    if (kind === 'ellipse' || kind === 'star' || kind === 'triangle') { c.w = c.h = Math.round(Math.min(P.width, P.height) * 0.3); c.fill = '#ffd400'; c.opacity = 100; }
    if (kind === 'line' || kind === 'arrow') { c.w = Math.round(P.width * 0.4); c.h = 24; c.fill = '#ffd400'; c.opacity = 100; }
    if (kind === 'speech') { c.fill = '#ffffff'; c.opacity = 100; c.stroke = '#111111'; c.strokeW = 6; c.h = Math.round(P.height * 0.16); }
    return c;
  }
  function shapePath(ctx, c, w, h) {
    const x = -w / 2, y = -h / 2;
    ctx.beginPath();
    switch (c.shape) {
      case 'rect': ctx.rect(x, y, w, h); break;
      case 'round': { const r = Math.min(c.radius || 0, w / 2, h / 2); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); break; }
      case 'ellipse': ctx.ellipse(0, 0, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); break;
      case 'triangle': ctx.moveTo(0, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); break;
      case 'star': {
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.45 : 1; const px = Math.cos(a) * w / 2 * rr, py = Math.sin(a) * h / 2 * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.closePath(); break;
      }
      case 'line': ctx.rect(x, -h / 2, w, h); break;
      case 'arrow': { const hw = Math.min(w * 0.35, h * 2.2); ctx.moveTo(x, -h / 2); ctx.lineTo(x + w - hw, -h / 2); ctx.lineTo(x + w - hw, -h * 1.4); ctx.lineTo(x + w, 0); ctx.lineTo(x + w - hw, h * 1.4); ctx.lineTo(x + w - hw, h / 2); ctx.lineTo(x, h / 2); ctx.closePath(); break; }
      case 'speech': {
        const r = Math.min(c.radius || 24, w / 2, h / 2), tw = Math.min(w * 0.12, 60);
        ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.lineTo(x + w * 0.3 + tw, y + h); ctx.lineTo(x + w * 0.22, y + h + tw * 1.1); ctx.lineTo(x + w * 0.3, y + h);
        ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); break;
      }
      default: ctx.rect(x, y, w, h);
    }
  }
  /** シェイプを描いて、選択枠用の矩形を返す */
  function drawShape(ctx, c, ea, W, H) {
    const k = ea.scale / 100, w = (c.w || 200) * k, h = (c.h || 100) * k;
    const cx = W / 2 + ea.x, cy = H / 2 + ea.y;
    ctx.save();
    ctx.filter = filterOf(c, ea);
    ctx.translate(cx, cy);
    if (ea.rotation) ctx.rotate(ea.rotation * Math.PI / 180);
    shapePath(ctx, c, w, h);
    if (c.fillOn !== false) { ctx.fillStyle = c.fill || '#000'; ctx.fill(); }
    if (c.strokeW > 0) { ctx.lineWidth = c.strokeW * k; ctx.strokeStyle = c.stroke || '#fff'; ctx.lineJoin = 'round'; ctx.stroke(); }
    ctx.restore();
    const ext = c.shape === 'arrow' ? h * 0.9 : c.shape === 'speech' ? h * 0.2 : 0;
    return { x: cx - w / 2, y: cy - h / 2 - ext, w, h: h + ext * 2 };
  }
  /** 文字なしのシェイプだけのグラフィックを追加（あとから文字・画像・別のシェイプを重ねられる） */
  function shapeLayerOf(kind) {
    const L = defaultShapeLayer(kind || 'round');
    const s = Math.round(Math.min(P.width, P.height) * 0.32);
    L.name = SHAPE_NAME[kind] || 'シェイプ';
    if (['ellipse', 'star', 'triangle'].includes(kind)) { L.w = s; L.h = s; L.fill.paint = solidPaint('#ffd400'); }
    if (kind === 'rect') L.fill.paint = solidPaint('#e8392f');
    if (kind === 'line') { L.h = Math.max(8, Math.round(P.height * 0.008)); L.fill.paint = solidPaint('#ffffff'); }
    if (kind === 'arrow') { L.w = Math.round(s * 1.2); L.h = Math.round(s * 0.45); L.fill.paint = solidPaint('#ffd400'); }
    if (kind === 'speech') { L.w = Math.round(P.width * 0.5); L.h = Math.round(P.height * 0.16); L.fill.paint = solidPaint('#ffffff'); L.strokes = [{ on: true, width: 6, paint: solidPaint('#111111'), opacity: 100, join: 'round' }]; }
    return L;
  }
  function addShape(kind) {
    return addGraphic([shapeLayerOf(kind || 'round')], 'シェイプ');
  }

  /* =================================================================
     カラーピッカー（スポイト付き）
     ================================================================= */
  function parseColor(s) {
    s = String(s || '').trim();
    let m = s.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0] | 0, g: p[1] | 0, b: p[2] | 0, a: p[3] == null ? 1 : p[3] }; }
    // 色名などはブラウザに解釈させる
    const cx = document.createElement('canvas').getContext('2d'); cx.fillStyle = '#000'; cx.fillStyle = s;
    return cx.fillStyle.startsWith('#') ? parseColor(cx.fillStyle) : (cx.fillStyle.startsWith('rgba') ? parseColor(cx.fillStyle) : null);
  }
  const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  function toHex(c) { return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b); }
  /** 新しい色（#rrggbb）に、元の色の透明度を引き継ぐ */
  function withAlpha(hex, orig) {
    const o = parseColor(orig), n = parseColor(hex);
    if (!n) return orig;
    const a = n.a < 1 ? n.a : (o ? o.a : 1);
    return a < 0.999 ? `rgba(${n.r},${n.g},${n.b},${+a.toFixed(3)})` : toHex(n);
  }
  const RECENT_LS = 'cc-colors';
  function recentColors() { try { return JSON.parse(localStorage.getItem(RECENT_LS) || '[]'); } catch (e) { return []; } }
  function pushRecent(hex) { const l = [hex].concat(recentColors().filter((x) => x !== hex)).slice(0, 10); try { localStorage.setItem(RECENT_LS, JSON.stringify(l)); } catch (e) { /* ignore */ } }

  function colorField(label, key, value) {
    const p = parseColor(value) || { r: 0, g: 0, b: 0, a: 1 };
    return field(label, `<span class="cf" data-cf="${escapeHtml(key)}">
      <input type="color" value="${toHex(p)}" data-cfpick title="クリックで色を選ぶ">
      <input type="text" class="hex" value="${escapeHtml(String(value))}" data-cfhex spellcheck="false" title="カラーコード（#ff0000 / rgba(…)）">
      <button class="cf-eye" data-cfeye title="スポイト：画面のどこかをクリックすると、その色を読み取ります"><svg viewBox="0 0 24 24"><path d="M20.7 5.6l-2.3-2.3a1 1 0 00-1.4 0l-3.1 3.1-1.9-1.9-1.4 1.4 1.4 1.4L4 15.3V20h4.7l8-8 1.4 1.4 1.4-1.4-1.9-1.9 3.1-3.1a1 1 0 000-1.4zM7.9 18H6v-1.9l8-8 1.9 1.9z"/></svg></button></span>`);
  }
  function recentRow() {
    const l = recentColors();
    return l.length ? `<div class="recent"><span class="unit">最近の色</span>${l.map((c) => `<button class="sw" data-sw="${c}" style="background:${c}" title="${c}（最後に触った色の欄に入れる）"></button>`).join('')}</div>` : '';
  }
  /** スポイト：EyeDropper API（Chrome / Edge）。無ければモニターをクリックして取る */
  function pickColorFromScreen() {
    if (window.EyeDropper) return new window.EyeDropper().open().then((r) => r.sRGBHex).catch(() => null);
    return new Promise((resolve) => {
      toast('プログラムモニター上の、色を取りたい場所をクリックしてください（Esc でやめる）');
      overlay.style.cursor = 'crosshair';
      const done = (v) => { overlay.removeEventListener('pointerdown', on, true); document.removeEventListener('keydown', esc, true); overlay.style.cursor = ''; resolve(v); };
      const on = (e) => {
        e.stopPropagation(); e.preventDefault();
        const pt = monitorPoint(e);
        const d = pctx.getImageData(clamp(Math.round(pt.x), 0, P.width - 1), clamp(Math.round(pt.y), 0, P.height - 1), 1, 1).data;
        done(toHex({ r: d[0], g: d[1], b: d[2] }));
      };
      const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      overlay.addEventListener('pointerdown', on, true);
      document.addEventListener('keydown', esc, true);
    });
  }
  let lastColorKey = null;
  /** root 内のカラー欄をつなぐ。onChange(key, color, final) */
  function bindColorFields(root, getValue, onChange) {
    $$('[data-cf]', root).forEach((wrap) => {
      const key = wrap.dataset.cf;
      const pick = $('[data-cfpick]', wrap), hex = $('[data-cfhex]', wrap), eye = $('[data-cfeye]', wrap);
      const set = (v, final) => {
        const nv = withAlpha(v, getValue(key));
        hex.value = nv; const p = parseColor(nv); if (p) pick.value = toHex(p);
        onChange(key, nv, final);
        if (final && p) pushRecent(toHex(p));
      };
      wrap.addEventListener('focusin', () => { lastColorKey = key; });
      pick.addEventListener('input', () => set(pick.value, false));
      pick.addEventListener('change', () => set(pick.value, true));
      hex.addEventListener('change', () => { const p = parseColor(hex.value); if (p) { onChange(key, hex.value.trim(), true); pick.value = toHex(p); pushRecent(toHex(p)); } else toast('カラーコードを読めませんでした（例：#ff3355、rgba(0,0,0,0.6)）', true); });
      hex.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') hex.blur(); });
      eye.addEventListener('click', async () => { lastColorKey = key; const v = await pickColorFromScreen(); if (v) { set(v, true); toast(`色 ${v} を読み込みました`); } });
    });
    $$('[data-sw]', root).forEach((b) => b.addEventListener('click', () => {
      const key = lastColorKey && $(`[data-cf="${CSS.escape(lastColorKey)}"]`, root) ? lastColorKey : ($('[data-cf]', root) || {}).dataset.cf;
      if (!key) return;
      const wrap = $(`[data-cf="${CSS.escape(key)}"]`, root);
      const nv = withAlpha(b.dataset.sw, getValue(key));
      $('[data-cfhex]', wrap).value = nv; $('[data-cfpick]', wrap).value = b.dataset.sw;
      onChange(key, nv, true);
    }));
  }

  /* ---------- テロップの色（デザインの色を上書き） ---------- */
  const COLOR_LABEL = [
    [/^fill\.color$/, '文字色'], [/^fill\.stops\.(\d+)$/, (m) => `文字色（グラデ${+m[1] + 1}）`], [/^fill\.(a|b)$/, (m) => `文字色（しま${m[1] === 'a' ? 1 : 2}）`],
    [/^strokes\.(\d+)\.color$/, (m) => `縁取り${+m[1] + 1}`], [/^shadow\.color$/, '影'], [/^extrude\.color$/, '立体'], [/^glow\.color$/, '光彩'],
    [/^box\.fill\.color$/, '帯・座布団'], [/^box\.fill\.stops\.(\d+)$/, (m) => `帯（グラデ${+m[1] + 1}）`], [/^box\.fill\.(a|b)$/, (m) => `帯（しま${m[1] === 'a' ? 1 : 2}）`], [/^box\.accent\.color$/, '帯のアクセント'], [/^box\.stroke\.color$|^box\.border\.color$/, '帯の線'],
    [/^sub\.fill\.color$/, 'サブ文字'], [/^sub\.strokes\.(\d+)\.color$/, (m) => `サブの縁${+m[1] + 1}`], [/^sub\.box\.fill\.color$/, 'サブの帯'],
    [/^tag\.fill\.color$/, 'タグ文字'], [/^tag\.box\.fill\.color$/, 'タグの帯'], [/^deco\.(\d+)\.color$/, (m) => `飾り${+m[1] + 1}`],
  ];
  function colorLabel(path) {
    for (const [re, l] of COLOR_LABEL) { const m = path.match(re); if (m) return typeof l === 'function' ? l(m) : l; }
    return path;
  }
  function isColorStr(v) { return typeof v === 'string' && /^(#|rgba?\(|hsla?\()/i.test(v.trim()); }
  /** 解決済みスペックの中の色をすべて拾う → [{path, value}] */
  function colorSlots(spec) {
    const out = [];
    const walk = (o, path) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) {
        if (path.endsWith('stops')) o.forEach((st2, i) => { if (Array.isArray(st2) && isColorStr(st2[1])) out.push({ path: `${path}.${i}`, value: st2[1] }); });
        else o.forEach((x, i) => walk(x, `${path}.${i}`));
        return;
      }
      for (const [k, v] of Object.entries(o)) {
        if (k === 'variants' || k === 'font') continue;
        const p = path ? `${path}.${k}` : k;
        // グラデーション・しま模様の塗りでは、使われていない color は出さない
        if (k === 'color' && (o.type === 'gradient' || o.type === 'stripes')) continue;
        if (isColorStr(v) && (k === 'color' || ((k === 'a' || k === 'b') && o.type === 'stripes'))) out.push({ path: p, value: v });
        else if (v && typeof v === 'object') walk(v, p);
      }
    };
    walk(spec, '');
    return out;
  }
  function setAtPath(o, path, v) {
    const ks = path.split('.');
    let cur = o;
    for (let i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] == null) return; cur = cur[ks[i]]; }
    const last = ks[ks.length - 1];
    if (Array.isArray(cur) && Array.isArray(cur[last])) cur[last][1] = v; // グラデの [位置, 色]
    else cur[last] = v;
  }
  /** 色の上書きを反映したデザイン（variants は解決済み） */
  function telopDesignFor(c) {
    const d = designById.get(c.designId);
    if (!d || !c.colorOv || !Object.keys(c.colorOv).length) return { d, variant: c.variant || 0 };
    const spec = R.resolve(d, c.variant || 0);
    delete spec.variants;
    for (const [p, v] of Object.entries(c.colorOv)) setAtPath(spec, p, v);
    return { d: spec, variant: 0 };
  }

  /* =================================================================
     音声で編集（Web Speech API・日本語）
     「再生して」「止めて」「ここから」「ここまで」「その部分カット」「テロップ入れて こんにちは」など
     ================================================================= */
  const SE_WORDS = [
    [/ピンポン|正解/, 'seikai'], [/ブブー|不正解/, 'buzzer'], [/ドドン/, 'dodon'], [/ドン|衝撃/, 'don'], [/ジャーン|ジャン/, 'jan'], [/ズーン/, 'zun'],
    [/チーン|チン/, 'chin'], [/ボヨーン|ボヨン/, 'boing'], [/拍手/, 'clap'], [/キラーン|キラキラ|キラン/, 'kira'], [/ピコン/, 'pikon'],
    [/シュッ|シュー|ヒュッ/, 'whoosh'], [/スッ|スワイプ/, 'swipe'], [/ポーン/, 'pon'], [/ポン|ポップ/, 'pop'], [/カシャ|シャッター/, 'shutter'],
    [/カタカタ|タイピング/, 'type'], [/ドラムロール/, 'drumroll'], [/ヒューン/, 'hyun'], [/ビューン/, 'byun'],
  ];
  const KANJI_NUM = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function parseNum(s) {
    if (s == null) return null;
    s = String(s).normalize('NFKC');
    if (/^\d+(\.\d+)?$/.test(s)) return +s;
    if (s === '半') return 0.5;
    let n = 0, cur = 0;
    for (const ch of s) {
      if (ch in KANJI_NUM) cur = KANJI_NUM[ch];
      else if (ch === '十') { n += (cur || 1) * 10; cur = 0; }
      else return null;
    }
    return n + cur;
  }
  const NUM = '([0-9０-９.]+|[〇零一二三四五六七八九十]+|半)';
  function pauseFor() { if (st.playing) pause(); }
  function clipUnderPlayhead(kinds) {
    const sel = P.clips.find((c) => st.sel.has(c.id) && isActive(c, st.time) && (!kinds || kinds.includes(c.type)));
    if (sel) return sel;
    const order = P.tracks.filter((t) => t.kind === 'video').map((t) => t.id).reverse(); // V1 を優先
    return P.clips.filter((c) => isActive(c, st.time) && (!kinds || kinds.includes(c.type))).sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track))[0];
  }
  function addTelopWithText(text) {
    cmd.addTelop();
    const c = P.clips.find((x) => st.sel.has(x.id) && x.type === 'telop');
    if (c && text) { c.text = text.replace(/!/g, '！').replace(/\?/g, '？'); telopCache.delete(c.id); changed({ props: true }); }
    return c;
  }
  /** 話した言葉 → 操作。実行した内容（説明）を返す。わからなければ null */
  function voiceCommand(raw) {
    // 空白と句読点だけ落とす（テロップの「！」「？」は残す）
    const t = String(raw || '').normalize('NFKC').replace(/[\s。、,.]/g, '').replace(/[!?]+$/, (x) => (/[」』]/.test(String(raw)) ? x : ''));
    if (!t) return null;
    let m;
    // --- テロップ ---
    if (/テロップ|字幕/.test(t)) {
      if (/消|削除/.test(t)) { pauseFor(); const c = clipUnderPlayhead(['telop']); if (!c) return 'ここにテロップはありません'; pushUndo(); P.clips = P.clips.filter((x) => x !== c); st.sel.delete(c.id); changed({ structure: true }); return 'テロップを削除'; }
      if ((m = t.match(/テロップ(?:の文字)?を(.+?)に(?:変えて|変更|して|直して)/))) {
        const c = clipUnderPlayhead(['telop']); if (!c) return 'ここにテロップはありません';
        pushUndo(); c.text = m[1]; telopCache.delete(c.id); changed({ props: true }); return `テロップを「${m[1]}」に変更`;
      }
      // 「〇〇」ってテロップ入れて / テロップで〇〇 / テロップ入れて〇〇
      let text = '';
      if ((m = t.match(/^[「『]?(.+?)[」』]?(?:って|と)(?:テロップ|字幕)/))) text = m[1];
      else if ((m = t.match(/(?:テロップ|字幕)(?:を)?(?:入れて|いれて|追加して?|出して|お願い)[:：]?(.+)$/))) text = m[1];
      else if ((m = t.match(/(?:テロップ|字幕)(?:で|に|は)[「『]?(.+?)[」』]?(?:入れて|いれて|追加|出して|お願い)?$/))) text = m[1];
      text = text.replace(/^[「『]|[」』]$/g, '').replace(/(?:入れて|いれて|お願い|追加して?)$/, '');
      pauseFor();
      addTelopWithText(text);
      return text ? `テロップ「${text}」を追加` : 'テロップを追加（文字を入力してください）';
    }
    // --- 取り消し ---
    if (/取り消|元に戻|戻して$|アンドゥ/.test(t) && !/秒/.test(t)) { undo(); return '取り消し'; }
    if (/やり直/.test(t)) { redo(); return 'やり直し'; }
    // --- 範囲 ---
    if (/ここから|イン点|始まり(?:を)?(?:ここ|マーク)/.test(t) && !/ここまで/.test(t)) { setMark('in', st.time); return `イン点 ${tc(st.time)}`; }
    if (/ここまで|アウト点/.test(t)) { setMark('out', st.time); return `アウト点 ${tc(st.time)}${/カット|消|削除/.test(t) ? '' : '（「その部分カット」で削除できます）'}`; }
    // --- 前後を削除（Q / W） ---
    if (/(?:前|手前)(?:を|は|全部)?(?:カット|消|削除|いらない)/.test(t)) { pauseFor(); rippleTrim(-1); return '前の編集点まで削除して詰めた'; }
    if (/(?:後ろ|うしろ|後|あと)(?:を|は|全部)?(?:カット|消|削除|いらない)/.test(t)) { pauseFor(); rippleTrim(1); return '次の編集点まで削除して詰めた'; }
    // --- 範囲・部分のカット ---
    if (/(?:その|この|ここの)?(?:部分|範囲|ところ|とこ)(?:を|は)?(?:カット|消|削除|いらない|詰め)/.test(t) || /(?:カット|削除)して詰め/.test(t)) {
      pauseFor();
      if (inOut()) { liftOrExtract(true); return 'イン〜アウトを削除して詰めた'; }
      if (st.sel.size) { deleteSelected(true); return '選択したクリップを削除して詰めた'; }
      splitAtPlayhead();
      return 'ここで分割（範囲を消すときは「ここから」「ここまで」のあとに「その部分カット」）';
    }
    if (/無音/.test(t)) { pauseFor(); silenceDialog(); return '無音カットの画面を開いた'; }
    if (/文字起こし/.test(t)) { pauseFor(); st.ltab = 'tx'; $('[data-ltab="tx"]').click(); transcribe(); return '文字起こしを開始'; }
    if (/(?:カット|切って|切る|分割|割って)/.test(t)) { pauseFor(); splitAtPlayhead(); return `${tc(st.time)} で分割`; }
    if (/(?:削除|消して|消す)/.test(t)) { pauseFor(); if (!st.sel.size) { const c = clipUnderPlayhead(); if (c) st.sel = new Set([c.id]); } if (!st.sel.size) return '消すクリップがありません'; deleteSelected(false); return '削除'; }
    // --- 効果音 ---
    for (const [re, file] of SE_WORDS) { const mm = t.match(re); if (mm && (/入れ|鳴ら|追加|効果音|SE|音/.test(t) || t.length <= 6)) { addSe(file + '.wav', st.time); return `効果音「${mm[0]}」を追加`; } }
    if (/効果音|SE/.test(t)) { $('[data-ltab="se"]').click(); return '効果音の一覧を開いた'; }
    // --- シェイプ ---
    if (/シェイプ|図形|四角|丸|星|矢印|吹き出し|三角|座布団/.test(t)) {
      pauseFor();
      const kind = /丸/.test(t) && !/角丸/.test(t) ? 'ellipse' : /星/.test(t) ? 'star' : /矢印/.test(t) ? 'arrow' : /吹き出し/.test(t) ? 'speech' : /三角/.test(t) ? 'triangle' : /線/.test(t) ? 'line' : 'round';
      addShape(kind); return `シェイプ（${SHAPE_NAME[kind]}）を追加`;
    }
    // --- 演出 ---
    if (/パンチ|寄って|アップ|拡大|ズームイン|ズーム/.test(t) && !/タイムライン/.test(t)) {
      pauseFor(); const c = clipUnderPlayhead(['video', 'image']); if (!c) return 'ここに映像がありません';
      pushUndo(); applyPreset(c, 'punch'); changed({ props: true }); return 'パンチイン';
    }
    if (/揺ら|揺れ|シェイク/.test(t)) { const c = clipUnderPlayhead(['video', 'image', 'telop', 'shape']); if (!c) return 'ここにクリップがありません'; pushUndo(); c.fx = Object.assign(c.fx || {}, { shake: 14 }); changed({ props: true }); return '揺れを追加'; }
    // --- 移動 ---
    if ((m = t.match(new RegExp(NUM + '秒(?:戻|前|巻き戻)')))) { const n = parseNum(m[1]) || 5; seek(snapFrame(st.time - n)); followPlayhead(); return `${n}秒戻った`; }
    if ((m = t.match(new RegExp(NUM + '秒(?:進|先|後|飛ば|送)')))) { const n = parseNum(m[1]) || 5; seek(snapFrame(st.time + n)); followPlayhead(); return `${n}秒進んだ`; }
    if ((m = t.match(new RegExp(NUM + '分' + NUM + '?秒?(?:に|へ|まで)?(?:移動|行って|飛んで|ジャンプ)')))) { const s2 = (parseNum(m[1]) || 0) * 60 + (parseNum(m[2]) || 0); seek(s2); followPlayhead(); return `${tc(s2)} へ移動`; }
    if (/最初|先頭|頭から|始めから|はじめから/.test(t)) { seek(0); scroller.scrollLeft = 0; if (/再生/.test(t)) { st.rate = 1; play(); return '先頭から再生'; } return '先頭へ'; }
    if (/最後|末尾|終わり/.test(t)) { pause(); seek(duration()); followPlayhead(); return '末尾へ'; }
    if (/次の(?:編集点|カット|切れ目)|次へ/.test(t)) { cmd.nextEdit(); return '次の編集点へ'; }
    if (/前の(?:編集点|カット|切れ目)|前へ/.test(t)) { cmd.prevEdit(); return '前の編集点へ'; }
    if (/戻って|巻き戻/.test(t)) { seek(snapFrame(st.time - 5)); followPlayhead(); return '5秒戻った'; }
    if (/早送り|進んで|飛ばして/.test(t)) { seek(snapFrame(st.time + 5)); followPlayhead(); return '5秒進んだ'; }
    // --- 再生 ---
    if (/止め|止ま|ストップ|停止|待って|ポーズ|一時停止/.test(t)) { pause(); return '停止'; }
    if (/再生|プレイ|スタート|流して|見せて/.test(t)) { if (!st.playing) { st.rate = 1; play(); } return '再生'; }
    // --- その他 ---
    if (/全体/.test(t)) { zoomFit(); return '全体を表示'; }
    if (/書き出/.test(t)) { pauseFor(); exportDialog(); return '書き出しの画面を開いた'; }
    if (/保存/.test(t)) { saveProjectFile(); return 'プロジェクトを保存'; }
    return null;
  }

  // ---- マイクと表示 ----
  let rec = null, voiceOn = false;
  const VOICE_HELP = [
    ['再生して ／ 止めて', '再生・停止'], ['5秒戻って ／ 10秒進んで', '移動'], ['最初から再生 ／ 最後へ', '先頭・末尾'],
    ['ここから … ここまで', '範囲を指定'], ['その部分カット', '範囲（なければ選択）を削除して詰める'], ['カット ／ ここで切って', '再生ヘッドで分割'],
    ['前をカット ／ 後ろをカット', 'Q / W と同じ'], ['テロップ入れて こんにちは', '文字つきでテロップを追加'], ['「すごい」ってテロップ', '同上'],
    ['テロップを〇〇に変えて', 'ここにあるテロップの文字を変更'], ['ドン入れて ／ 拍手', '効果音'], ['パンチイン ／ 揺らして', '演出'],
    ['四角入れて ／ 矢印 ／ 吹き出し', 'シェイプ'], ['無音カット ／ 文字起こし', '各機能'], ['取り消し ／ やり直し', 'Undo / Redo'],
  ];
  function voiceHud(heard, result, interim) {
    let el = $('#voice-hud');
    if (!el) {
      el = document.createElement('div'); el.id = 'voice-hud';
      el.innerHTML = '<div class="vh-top"><span class="vh-dot"></span><b>音声で編集</b><span class="unit" style="margin-left:6px">話しかけてください</span><button class="vh-help" title="話せる言葉の一覧">？</button><button class="vh-x" title="終了">×</button></div><div class="vh-heard"></div><div class="vh-res"></div>';
      document.body.appendChild(el);
      $('.vh-x', el).addEventListener('click', () => toggleVoice(false));
      $('.vh-help', el).addEventListener('click', () => openModal('音声で使える言葉', `<div class="keys">${VOICE_HELP.map(([a, b]) => `<span><kbd style="font-size:11.5px">${a}</kbd></span><span>${b}</span>`).join('')}</div><p class="note" style="font-size:11px;color:var(--muted);margin-top:8px">言い方は多少違っても大丈夫です。再生中は動画の音をマイクが拾うことがあるので、イヤホンを使うか、止めてから話すと確実です。</p>`, [['閉じる', null, true]]));
    }
    el.classList.toggle('hidden', !voiceOn);
    if (heard != null) $('.vh-heard', el).textContent = heard ? `「${heard}」` : '';
    $('.vh-heard', el).classList.toggle('interim', !!interim);
    if (result !== undefined) { const r = $('.vh-res', el); r.textContent = result || ''; r.classList.toggle('ng', result != null && result.startsWith('？')); }
  }
  function toggleVoice(on) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (on === undefined) on = !voiceOn;
    if (on && !SR) { openModal('音声操作が使えません', '<p>このブラウザは音声認識に対応していません。<b>Chrome</b> か <b>Edge</b>（パソコン）でお使いください。</p>', [['閉じる', null, true]]); return; }
    voiceOn = on;
    $('#btn-voice').classList.toggle('on', on);
    if (on) {
      if (!rec) {
        rec = new SR();
        rec.lang = 'ja-JP'; rec.continuous = true; rec.interimResults = true;
        rec.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i], text = r[0].transcript;
            if (!r.isFinal) { voiceHud(text, undefined, true); continue; }
            const done = voiceCommand(text);
            voiceHud(text, done ? '✓ ' + done : '？ わかりませんでした（「？」で一覧）');
          }
        };
        rec.onerror = (e) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('マイクの使用が許可されていません。アドレスバーのマイクのアイコンから許可してください', true); toggleVoice(false); }
          else if (e.error === 'network') voiceHud(null, '？ 音声認識のサーバーにつながりません（ネット接続を確認）');
        };
        rec.onend = () => { if (voiceOn) { try { rec.start(); } catch (e2) { /* ignore */ } } };
      }
      try { rec.start(); } catch (e) { /* 既に開始済み */ }
      voiceHud('', '');
    } else if (rec) { try { rec.stop(); } catch (e) { /* ignore */ } voiceHud(null); }
    voiceHud(null);
  }

  /* =================================================================
     グラフィック（レイヤー）— 1つのクリップに テキスト / シェイプ / 画像 を重ねる
     clip = { type:'graphic', layers:[ 下から順に ] , x,y,scale,rotation,opacity,kf,fx,trIn,trOut }
     layer = { id, kind:'text'|'shape'|'image', name, visible, locked, x, y, scale, rotation, opacity, kf, ... }
     paint = { type:'solid', color } | { type:'linear'|'radial', angle, stops:[[0..1, color], ...] }
     ================================================================= */
  const FONT_LIST = Object.keys((D && D.FONTS) || {}).concat(['sans-serif', 'serif']);
  const solidPaint = (color) => ({ type: 'solid', color });
  function defaultTextLayer(text) {
    return {
      id: uid('L'), kind: 'text', name: 'テキスト', visible: true, locked: false, x: 0, y: 0, scale: 100, rotation: 0, opacity: 100,
      text: text || 'テキスト', font: { family: 'Noto Sans JP', weight: 900, size: 110, letterSpacing: 0.02, lineHeight: 1.2, italic: false }, align: 'center',
      fill: { on: true, paint: solidPaint('#ffffff') },
      strokes: [{ on: true, width: 12, paint: solidPaint('#111111'), join: 'round', opacity: 100 }],
      shadow: { on: true, paint: solidPaint('#000000'), opacity: 55, distance: 8, angle: 135, length: 0, hardness: 70 },
      texture: { on: false, kind: 'stripes', mediaId: null, scale: 100, opacity: 60, blend: 'multiply' },
    };
  }
  function defaultShapeLayer(kind) {
    return {
      id: uid('L'), kind: 'shape', name: 'シェイプ', visible: true, locked: false, x: 0, y: 0, scale: 100, rotation: 0, opacity: 100,
      shape: kind || 'round', w: Math.round(P.width * 0.55), h: Math.round(P.height * 0.16), radius: 24,
      fill: { on: true, paint: solidPaint('rgba(0,0,0,0.7)') }, strokes: [], shadow: { on: false, paint: solidPaint('#000000'), opacity: 50, distance: 10, angle: 135, length: 0, hardness: 40 },
    };
  }
  function defaultImageLayer(mediaId) {
    const m = mediaMeta(mediaId) || {};
    const w = Math.round(Math.min(P.width * 0.4, m.width || 400));
    return { id: uid('L'), kind: 'image', name: m.name || '画像', visible: true, locked: false, x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, mediaId, w };
  }
  function makeGraphicClip(track, start, layers) {
    const c = baseClip('graphic', track, start, 4);
    Object.assign(c, { name: 'グラフィック', layers: layers || [defaultTextLayer()], fadeIn: 0.1, fadeOut: 0.1 });
    return c;
  }
  function addGraphic(layers, name) {
    pushUndo();
    const tr = freeVideoTrack(st.time, 5);
    const c = makeGraphicClip(tr.id, st.time, layers);
    if (name) c.name = name;
    P.clips.push(c); st.sel = new Set([c.id]);
    st.selLayer = { clipId: c.id, layerId: c.layers[c.layers.length - 1].id };
    changed({ structure: true });
    return c;
  }

  /* ---------- 塗り（単色・グラデーション） ---------- */
  function paintStyle(ctx, paint, w, h, alphaMul) {
    if (!paint) return '#fff';
    if (typeof paint === 'string') return paint;
    if (paint.type === 'linear' || paint.type === 'radial') {
      const stops = (paint.stops && paint.stops.length ? paint.stops : [[0, '#fff'], [1, '#000']]);
      let g;
      if (paint.type === 'radial') g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) / 2);
      else {
        const a = ((paint.angle == null ? 90 : paint.angle) * Math.PI) / 180;
        const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
        const dx = (Math.sin(a) * len) / 2, dy = (-Math.cos(a) * len) / 2;
        g = ctx.createLinearGradient(-dx, -dy, dx, dy);
      }
      for (const [pos, col] of stops) { try { g.addColorStop(clamp(pos, 0, 1), col); } catch (e) { /* ignore */ } }
      return g;
    }
    return paint.color || '#fff';
  }
  /** テロップデザインの塗り → paint */
  function paintFromSpec(f) {
    if (!f) return solidPaint('#ffffff');
    if (typeof f === 'string') return solidPaint(f);
    if (f.type === 'gradient') return { type: 'linear', angle: f.angle == null ? 90 : f.angle, stops: (f.stops || []).map((s) => [s[0], s[1]]) };
    if (f.type === 'stripes') return { type: 'linear', angle: 0, stops: [[0, f.a || '#fff'], [1, f.b || '#000']] };
    return solidPaint(f.color || '#ffffff');
  }

  /* ---------- テクスチャ ---------- */
  const texCache = new Map();
  function texturePattern(ctx, tex) {
    if (tex.kind === 'image') {
      const rt = media.get(tex.mediaId);
      if (!rt || !rt.img) return null;
      return { img: rt.img };
    }
    const key = tex.kind;
    if (!texCache.has(key)) {
      const c = document.createElement('canvas'); const s = 64; c.width = c.height = s;
      const g = c.getContext('2d');
      if (key === 'stripes') { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.fillStyle = '#000'; for (let i = -s; i < s * 2; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 8 - s, s); g.lineTo(i - s, s); g.closePath(); g.fill(); } }
      else if (key === 'dots') { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.fillStyle = '#000'; for (let y = 8; y < s; y += 16) for (let x = 8; x < s; x += 16) { g.beginPath(); g.arc(x + ((y / 16) % 2) * 8, y, 4, 0, Math.PI * 2); g.fill(); } }
      else if (key === 'check') { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.fillStyle = '#000'; for (let y = 0; y < s; y += 16) for (let x = 0; x < s; x += 16) if (((x + y) / 16) % 2 === 0) g.fillRect(x, y, 16, 16); }
      else if (key === 'grain') { const im = g.createImageData(s, s); for (let i = 0; i < im.data.length; i += 4) { const v = 120 + Math.random() * 135; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); }
      else if (key === 'metal') { const gr = g.createLinearGradient(0, 0, 0, s); gr.addColorStop(0, '#fff'); gr.addColorStop(0.45, '#888'); gr.addColorStop(0.5, '#333'); gr.addColorStop(1, '#ccc'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }
      else if (key === 'paper') { g.fillStyle = '#ddd'; g.fillRect(0, 0, s, s); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`; g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1); } }
      texCache.set(key, c);
    }
    return { img: texCache.get(key) };
  }
  const TEXTURES = [['stripes', 'ストライプ'], ['dots', 'ドット'], ['check', 'チェック'], ['grain', 'ざらざら'], ['metal', 'メタル'], ['paper', '紙'], ['image', '画像を使う']];

  /* ---------- テキストレイヤーの描画（オフスクリーンに描いてキャッシュ） ---------- */
  const layerCache = new Map();
  function fontStr(f) { return `${f.italic ? 'italic ' : ''}${f.weight || 400} ${Math.max(1, f.size || 100)}px "${f.family || 'Noto Sans JP'}", sans-serif`; }
  function ensureFontLoaded(f, text) {
    const k = fontStr(f);
    if (fontReady.has(k) || !document.fonts) return;
    document.fonts.load(k, text || 'あA').then(() => { if (!fontReady.has(k)) { fontReady.add(k); layerCache.clear(); requestDraw(); } }).catch(() => {});
  }
  function measureText(ctx, L) {
    const f = L.font, size = f.size || 100;
    ctx.font = fontStr(f);
    const ls = (f.letterSpacing || 0) * size;
    const lines = String(L.text || '').split('\n');
    const widths = lines.map((l) => { let w = 0; for (const ch of l) w += ctx.measureText(ch).width + ls; return Math.max(0, w - ls); });
    const lh = (f.lineHeight || 1.2) * size;
    return { lines, widths, lh, ls, size, w: Math.max(1, ...widths), h: lh * lines.length };
  }
  function drawLines(ctx, L, m, mode, ox, oy) {
    const align = L.align || 'center';
    m.lines.forEach((line, i) => {
      const lw = m.widths[i];
      let x = align === 'left' ? -m.w / 2 : align === 'right' ? m.w / 2 - lw : -lw / 2;
      const y = -m.h / 2 + m.lh * i + m.lh / 2;
      for (const ch of line) {
        if (mode === 'stroke') ctx.strokeText(ch, x + ox, y + oy); else ctx.fillText(ch, x + ox, y + oy);
        x += ctx.measureText(ch).width + m.ls;
      }
    });
  }
  /** テキストレイヤー → { canvas, cx, cy（中心のずれ）, w, h（文字の箱） } */
  function renderTextLayer(L) {
    const key = JSON.stringify([L.text, L.font, L.align, L.fill, L.strokes, L.shadow, L.texture, fontReady.size, L.texture && L.texture.kind === 'image' && media.has(L.texture.mediaId)]);
    const hit = layerCache.get(L.id);
    if (hit && hit.key === key) return hit;
    ensureFontLoaded(L.font, L.text);
    const probe = document.createElement('canvas').getContext('2d');
    const m = measureText(probe, L);
    const strokes = (L.strokes || []).filter((s) => s.on !== false && s.width > 0);
    const strokeSum = strokes.reduce((a, s) => a + s.width, 0);
    const sh = L.shadow || {};
    const shOn = sh.on && sh.opacity > 0;
    const blur = shOn ? (100 - clamp(sh.hardness == null ? 70 : sh.hardness, 0, 100)) / 100 * 40 : 0;
    const shReach = shOn ? (sh.distance || 0) + (sh.length || 0) + blur * 2 : 0;
    const pad = Math.ceil(strokeSum + shReach + m.size * 0.3 + 8);
    const W = Math.ceil(m.w + pad * 2), H = Math.ceil(m.h + pad * 2);
    const cv = document.createElement('canvas'); cv.width = Math.min(8000, W); cv.height = Math.min(8000, H);
    const ctx = cv.getContext('2d');
    ctx.translate(W / 2, H / 2);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = fontStr(L.font); ctx.miterLimit = 3;
    // 文字の形（縁込み）をシルエットとして描く関数
    const silhouette = (g, ox, oy) => {
      g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = fontStr(L.font); g.lineJoin = 'round'; g.miterLimit = 3;
      g.fillStyle = '#000'; g.strokeStyle = '#000';
      if (strokeSum > 0) { g.lineWidth = strokeSum * 2; g.lineJoin = (strokes[strokes.length - 1] || {}).join || 'round'; drawLines(g, L, m, 'stroke', ox, oy); }
      drawLines(g, L, m, 'fill', ox, oy);
    };
    // 影（距離・角度・長さ・硬さ・不透明度・グラデ）
    if (shOn) {
      const sc = document.createElement('canvas'); sc.width = cv.width; sc.height = cv.height;
      const g = sc.getContext('2d'); g.translate(W / 2, H / 2);
      const a = ((sh.angle == null ? 135 : sh.angle) - 90) * Math.PI / 180; // 0°=上、時計回り
      const ux = Math.cos(a), uy = Math.sin(a);
      const steps = Math.min(240, Math.max(0, Math.round(sh.length || 0)));
      for (let i = steps; i >= 0; i--) { const d = (sh.distance || 0) + i; silhouette(g, ux * d, uy * d); }
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = paintStyle(g, sh.paint, m.w + strokeSum * 2, m.h + strokeSum * 2);
      g.fillRect(-W / 2, -H / 2, W, H);
      ctx.save();
      ctx.globalAlpha = clamp(sh.opacity / 100, 0, 1);
      if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      ctx.drawImage(sc, -W / 2, -H / 2);
      ctx.restore();
    }
    // エッジ（外側から順に）。各エッジの太さは内側のエッジの外に積み上がる
    let acc = strokeSum;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      ctx.save();
      ctx.globalAlpha = clamp((s.opacity == null ? 100 : s.opacity) / 100, 0, 1);
      ctx.lineJoin = s.join || 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = acc * 2;
      ctx.strokeStyle = paintStyle(ctx, s.paint, m.w + acc * 2, m.h + acc * 2);
      // 不透明度が 100 未満のとき下のエッジが透けないよう、まず内側を抜く
      drawLines(ctx, L, m, 'stroke', 0, 0);
      ctx.restore();
      acc -= s.width;
    }
    // 塗り＋テクスチャ
    if (!L.fill || L.fill.on !== false) {
      const fc = document.createElement('canvas'); fc.width = cv.width; fc.height = cv.height;
      const g = fc.getContext('2d'); g.translate(W / 2, H / 2);
      g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = fontStr(L.font);
      g.fillStyle = paintStyle(g, L.fill && L.fill.paint, m.w, m.h);
      drawLines(g, L, m, 'fill', 0, 0);
      const tex = L.texture;
      if (tex && tex.on) {
        const tp = texturePattern(g, tex);
        if (tp) {
          g.save();
          g.globalCompositeOperation = 'source-atop';
          g.globalAlpha = clamp((tex.opacity == null ? 60 : tex.opacity) / 100, 0, 1);
          const k = (tex.scale || 100) / 100;
          if (tex.kind === 'image') { const iw = tp.img.naturalWidth || tp.img.width, ih = tp.img.naturalHeight || tp.img.height; const s2 = Math.max(m.w / iw, m.h / ih) * k; g.drawImage(tp.img, -iw * s2 / 2, -ih * s2 / 2, iw * s2, ih * s2); }
          else { const pat = g.createPattern(tp.img, 'repeat'); if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().scale(k)); g.fillStyle = pat; g.globalCompositeOperation = tex.blend === 'normal' ? 'source-atop' : 'source-atop'; g.fillRect(-W / 2, -H / 2, W, H); }
          g.restore();
        }
      }
      ctx.save();
      ctx.globalAlpha = clamp(((L.fill && L.fill.opacity) == null ? 100 : L.fill.opacity) / 100, 0, 1);
      ctx.drawImage(fc, -W / 2, -H / 2);
      ctx.restore();
    }
    const out = { key, canvas: cv, w: m.w + strokeSum * 2, h: m.h + strokeSum * 2, W, H };
    layerCache.set(L.id, out);
    return out;
  }

  /* ---------- シェイプレイヤー ---------- */
  function drawShapeLayer(ctx, L) {
    const w = L.w || 200, h = L.h || 100;
    const strokes = (L.strokes || []).filter((s) => s.on !== false && s.width > 0);
    const sh = L.shadow || {};
    const fake = { shape: L.shape, radius: L.radius };
    if (sh.on && sh.opacity > 0) {
      ctx.save();
      const a = ((sh.angle == null ? 135 : sh.angle) - 90) * Math.PI / 180;
      const blur = (100 - clamp(sh.hardness == null ? 40 : sh.hardness, 0, 100)) / 100 * 40;
      ctx.globalAlpha *= clamp(sh.opacity / 100, 0, 1);
      if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      const steps = Math.min(240, Math.round(sh.length || 0));
      ctx.fillStyle = paintStyle(ctx, sh.paint, w, h);
      for (let i = steps; i >= 0; i--) { const d = (sh.distance || 0) + i; ctx.save(); ctx.translate(Math.cos(a) * d, Math.sin(a) * d); shapePath(ctx, fake, w, h); ctx.fill(); ctx.restore(); }
      ctx.restore();
    }
    let acc = strokes.reduce((x, s) => x + s.width, 0);
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      ctx.save(); ctx.globalAlpha *= clamp((s.opacity == null ? 100 : s.opacity) / 100, 0, 1);
      ctx.lineJoin = s.join || 'round'; ctx.lineWidth = acc * 2; ctx.strokeStyle = paintStyle(ctx, s.paint, w, h);
      shapePath(ctx, fake, w, h); ctx.stroke(); ctx.restore();
      acc -= s.width;
    }
    if (!L.fill || L.fill.on !== false) { ctx.fillStyle = paintStyle(ctx, L.fill && L.fill.paint, w, h); shapePath(ctx, fake, w, h); ctx.fill(); }
    return { w, h };
  }

  /* ---------- レイヤーごとのアニメーション（キーフレームはクリップの先頭からの秒） ---------- */
  function layerVal(L, prop, lt) {
    const k = L.kf && L.kf[prop];
    const base = L[prop] == null ? KF_DEFAULT[prop] : L[prop];
    if (!k || !k.length) return base;
    return kfAt(k, lt);
  }
  /** グラフィックを描く。返り値：クリップ全体の矩形と、レイヤーごとの矩形 */
  const layerRects = {};
  function drawGraphic(ctx, c, ea, W, H, t) {
    const lt = t - c.start;
    const rects = {};
    let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
    ctx.save();
    ctx.filter = filterOf(c, ea);
    ctx.translate(W / 2 + ea.x, H / 2 + ea.y);
    if (ea.rotation) ctx.rotate(ea.rotation * Math.PI / 180);
    const gk = ea.scale / 100;
    ctx.scale(gk, gk);
    const baseAlpha = ctx.globalAlpha;
    for (const L of c.layers || []) {
      if (L.visible === false) continue;
      const lx = layerVal(L, 'x', lt), ly = layerVal(L, 'y', lt), ls = layerVal(L, 'scale', lt) / 100, lr = layerVal(L, 'rotation', lt), lo = layerVal(L, 'opacity', lt) / 100;
      if (lo <= 0.001) continue;
      ctx.save();
      ctx.globalAlpha = baseAlpha * clamp(lo, 0, 1);
      ctx.translate(lx, ly);
      if (lr) ctx.rotate(lr * Math.PI / 180);
      ctx.scale(ls, ls);
      let bw = 0, bh = 0;
      if (L.kind === 'text') {
        const r = renderTextLayer(L);
        ctx.drawImage(r.canvas, -r.W / 2, -r.H / 2);
        bw = r.w; bh = r.h;
      } else if (L.kind === 'shape') {
        const r = drawShapeLayer(ctx, L); bw = r.w; bh = r.h;
      } else if (L.kind === 'image') {
        const rt = media.get(L.mediaId);
        if (rt && rt.img) { const iw = rt.img.naturalWidth, ih = rt.img.naturalHeight; bw = L.w || iw; bh = bw * ih / iw; ctx.drawImage(rt.img, -bw / 2, -bh / 2, bw, bh); }
      }
      ctx.restore();
      // フレーム座標の外接矩形（回転は近似）
      const k = gk * ls;
      const cx = W / 2 + ea.x + lx * gk, cy = H / 2 + ea.y + ly * gk;
      const rad = (lr + (ea.rotation || 0)) * Math.PI / 180;
      const hw = (Math.abs(Math.cos(rad)) * bw + Math.abs(Math.sin(rad)) * bh) * k / 2, hh = (Math.abs(Math.sin(rad)) * bw + Math.abs(Math.cos(rad)) * bh) * k / 2;
      rects[L.id] = { x: cx - hw, y: cy - hh, w: hw * 2, h: hh * 2, cx, cy };
      ux0 = Math.min(ux0, cx - hw); uy0 = Math.min(uy0, cy - hh); ux1 = Math.max(ux1, cx + hw); uy1 = Math.max(uy1, cy + hh);
    }
    ctx.restore();
    layerRects[c.id] = rects;
    return isFinite(ux0) ? { x: ux0, y: uy0, w: ux1 - ux0, h: uy1 - uy0 } : { x: W / 2, y: H / 2, w: 1, h: 1 };
  }
  function selectedLayer(c) {
    if (!c || c.type !== 'graphic') return null;
    const s = st.selLayer;
    if (s && s.clipId === c.id) { const L = c.layers.find((x) => x.id === s.layerId); if (L) return L; }
    return null;
  }
  async function ensureGraphicFonts() {
    const jobs = [];
    for (const c of P.clips) if (c.type === 'graphic') for (const L of c.layers || []) if (L.kind === 'text' && document.fonts) jobs.push(document.fonts.load(fontStr(L.font), L.text || 'あ').then(() => fontReady.add(fontStr(L.font))).catch(() => {}));
    await Promise.all(jobs);
    layerCache.clear();
  }

  /* ---------- テロップのデザイン → レイヤー ---------- */
  /** テロップの文字スタイル（フォント・塗り・縁・影）を text レイヤーへ */
  function styleFromSpec(spec, L, scale) {
    const f = spec.font || {};
    L.font = { family: f.family || 'Noto Sans JP', weight: +f.weight || 900, size: Math.round((f.size || 96) * scale), letterSpacing: f.letterSpacing || 0, lineHeight: spec.lineHeight || 1.18, italic: !!f.italic };
    L.fill = { on: true, paint: paintFromSpec(spec.fill) };
    const ss = (spec.strokes || []).slice().sort((a, b) => a.width - b.width);
    let prev = 0;
    L.strokes = ss.map((s) => { const w = Math.max(0.5, (s.width - prev) * scale); prev = s.width; return { on: true, width: Math.round(w * 10) / 10, paint: s.fill ? paintFromSpec(s.fill) : solidPaint(s.color || '#000'), join: 'round', opacity: 100 }; });
    if (spec.extrude) {
      const e = spec.extrude, dx = e.dx == null ? 1 : e.dx, dy = e.dy == null ? 1 : e.dy;
      L.shadow = { on: true, paint: solidPaint(e.color || '#000'), opacity: 100, distance: 0, angle: Math.round(Math.atan2(dy, dx) * 180 / Math.PI + 90), length: Math.round(e.depth * Math.hypot(dx, dy) * scale), hardness: 100 };
    } else if (spec.shadow) {
      const s = spec.shadow, p = parseColor(s.color) || { a: 0.5 };
      L.shadow = { on: true, paint: solidPaint(toHex(p.r != null ? p : { r: 0, g: 0, b: 0 })), opacity: Math.round((p.a == null ? 1 : p.a) * 100), distance: Math.round(Math.hypot(s.dx || 0, s.dy || 0) * scale), angle: Math.round(Math.atan2(s.dy || 0, s.dx || 0) * 180 / Math.PI + 90), length: 0, hardness: Math.round(clamp(100 - (s.blur || 0) * 2.5, 0, 100)) };
    } else if (spec.glow) {
      L.shadow = { on: true, paint: solidPaint(spec.glow.color || '#fff'), opacity: 90, distance: 0, angle: 135, length: 0, hardness: 20 };
    } else L.shadow = Object.assign({}, L.shadow || {}, { on: false });
  }
  /** テロップクリップ（またはデザイン）→ グラフィックのレイヤー一式 */
  function layersFromTelop(designId, variant, text, sub, colorOv, scalePct) {
    const d = designById.get(designId); if (!d) return null;
    let spec = R.resolve(d, variant || 0);
    if (colorOv) for (const [p, v] of Object.entries(colorOv)) setAtPath(spec, p, v);
    const W = P.width, H = P.height;
    const tmp = document.createElement('canvas');
    const res = R.render(tmp, Object.assign({}, spec, { variants: undefined }), { width: W, height: H, variant: 0, text: text || d.sample || 'テキスト', sub: sub || '', scale: (scalePct || 100) / 100 });
    const rect = (res && res.rect) || { x: W / 4, y: H * 0.7, w: W / 2, h: 140 };
    const scale = (W < H ? (spec.portraitScale || 0.8) : 1) * (scalePct || 100) / 100;
    const layers = [];
    const cx = rect.x + rect.w / 2 - W / 2, cy = rect.y + rect.h / 2 - H / 2;
    const box = spec.box;
    if (box && box.type && box.type !== 'none') {
      const S = defaultShapeLayer('rect');
      S.name = '帯';
      S.shape = box.type === 'pill' ? 'round' : box.type === 'round' ? 'round' : box.type === 'speech' ? 'speech' : 'rect';
      S.radius = box.type === 'pill' ? rect.h / 2 : (box.radius || 18) * scale;
      S.w = Math.round(box.type === 'bar' ? W : rect.w); S.h = Math.round(rect.h); S.x = box.type === 'bar' ? 0 : Math.round(cx); S.y = Math.round(cy);
      if (box.type === 'underline') { S.shape = 'rect'; S.h = Math.max(3, (box.thickness || 4) * scale); S.y = Math.round(cy + rect.h / 2 - S.h); }
      S.fill = { on: true, paint: paintFromSpec(box.fill) };
      S.strokes = box.stroke && box.stroke.color ? [{ on: true, width: (box.stroke.width || 3) * scale, paint: solidPaint(box.stroke.color), join: 'miter', opacity: 100 }] : [];
      layers.push(S);
      if (box.accent && box.accent.color) {
        const A = defaultShapeLayer('rect'); A.name = '帯のアクセント'; A.shape = 'rect';
        const side = box.accent.side || 'left', aw = (box.accent.width || 6) * scale;
        if (side === 'top' || side === 'bottom') { A.w = S.w; A.h = aw; A.x = S.x; A.y = Math.round(S.y + (side === 'top' ? -1 : 1) * (S.h / 2 - aw / 2)); }
        else { A.w = aw; A.h = S.h; A.y = S.y; A.x = Math.round(S.x + (side === 'left' ? -1 : 1) * (S.w / 2 - aw / 2)); }
        A.fill = { on: true, paint: solidPaint(box.accent.color) };
        layers.push(A);
      }
    }
    const T = defaultTextLayer(text || d.sample || 'テキスト');
    T.name = 'テキスト';
    styleFromSpec(spec, T, scale);
    T.x = Math.round(cx); T.y = Math.round(cy);
    if (spec.align === 'left' || (box && box.type === 'bar')) { T.align = spec.align || 'left'; }
    layers.push(T);
    if (spec.sub && sub) {
      const Sb = defaultTextLayer(sub); Sb.name = 'サブ';
      styleFromSpec(Object.assign({ lineHeight: spec.sub.lineHeight || 1.2 }, spec.sub), Sb, scale);
      const pos = spec.sub.position || 'above';
      const mctx = document.createElement('canvas').getContext('2d');
      const sm = measureText(mctx, Sb);
      const salign = pos === 'right' ? 'left' : (spec.sub.align || 'center');
      const gap = (spec.sub.gap == null ? 10 : spec.sub.gap) * scale;
      Sb.y = Math.round(pos === 'above' ? cy - rect.h / 2 - gap - sm.h / 2 : pos === 'below' ? cy + rect.h / 2 + gap + sm.h / 2 : cy);
      if (pos === 'right') Sb.x = Math.round(cx + rect.w / 2 + gap + sm.w / 2);
      else if (salign === 'left') Sb.x = Math.round(cx - rect.w / 2 + (14 + (spec.sub.indent || 0)) * scale + sm.w / 2);
      else Sb.x = Math.round(cx);
      Sb.align = 'center';
      if (spec.sub.box && spec.sub.box.type !== 'none') {
        const sbx = spec.sub.box, spx = (spec.sub.padX == null ? 14 : spec.sub.padX) * scale, spy = (spec.sub.padY == null ? 0 : spec.sub.padY) * scale;
        const SB = defaultShapeLayer('rect'); SB.name = 'サブの帯';
        SB.w = Math.round(sm.w + spx * 2); SB.h = Math.round(sm.h + spy * 2); SB.x = Sb.x; SB.y = Sb.y;
        SB.shape = sbx.type === 'pill' ? 'round' : sbx.type === 'round' ? 'round' : 'rect';
        SB.radius = sbx.type === 'pill' ? SB.h / 2 : (sbx.radius || 8) * scale;
        SB.fill = { on: true, paint: paintFromSpec(sbx.fill) };
        layers.push(SB);
      }
      layers.push(Sb);
    }
    if (spec.tag && spec.tag.text) {
      const tg = spec.tag;
      const TB = defaultShapeLayer('rect'); TB.name = 'タグの帯';
      const TT = defaultTextLayer(tg.text); TT.name = 'タグ';
      styleFromSpec(Object.assign({ lineHeight: 1.2 }, tg), TT, scale);
      const tw = TT.font.size * Array.from(tg.text).length * 0.95 + (tg.padX || 18) * 2 * scale, th = TT.font.size * 1.2 + (tg.padY || 8) * 2 * scale;
      TB.w = Math.round(tw); TB.h = Math.round(th); TB.fill = { on: true, paint: paintFromSpec(tg.box && tg.box.fill) };
      TB.x = Math.round(cx - rect.w / 2 + tw / 2 + 10 * scale); TB.y = Math.round((tg.position || 'left') === 'left' ? cy : cy - rect.h / 2 - th / 2);
      TT.x = TB.x; TT.y = TB.y;
      if ((tg.position || 'left') === 'left') T.x = Math.round(T.x + tw / 2);
      layers.push(TB, TT);
    }
    return layers;
  }
  function convertTelopToGraphic(c) {
    const layers = layersFromTelop(c.designId, c.variant, c.text, c.sub, c.colorOv, c.scale);
    if (!layers) return toast('このテロップは変換できません', true);
    pushUndo();
    const g = makeGraphicClip(c.track, c.start, layers);
    // テロップと同じ映像トラックの同じ位置に置き換える
    Object.assign(g, { track: c.track, dur: c.dur, fadeIn: c.fadeIn, fadeOut: c.fadeOut, x: c.x || 0, y: c.y || 0, kf: c.kf ? clone(c.kf) : undefined, fx: c.fx ? clone(c.fx) : undefined, trIn: c.trIn, trOut: c.trOut, name: (designById.get(c.designId) || {}).name || 'グラフィック' });
    P.clips = P.clips.filter((x) => x.id !== c.id);
    P.clips.push(g);
    st.sel = new Set([g.id]); st.selLayer = { clipId: g.id, layerId: g.layers.find((L) => L.kind === 'text').id };
    changed({ structure: true });
    toast('テロップをレイヤーに分解しました。レイヤーごとに文字・色・縁・影・動きを変えられます');
  }
  /** ライブラリで選んだテロップのデザインを、選択中のテキストレイヤーに適用（文字と位置はそのまま） */
  function applyDesignToTextLayer(L) {
    const d = designById.get(st.libDesign); if (!d) return toast('左の「テロップ」タブでデザインを選んでください');
    const spec = R.resolve(d, st.libVariant || 0);
    const keepSize = L.font && L.font.size;
    styleFromSpec(spec, L, 1);
    if (keepSize) { const k = keepSize / L.font.size; L.font.size = keepSize; L.strokes.forEach((s) => { s.width = Math.round(s.width * k * 10) / 10; }); if (L.shadow) { L.shadow.distance = Math.round((L.shadow.distance || 0) * k); L.shadow.length = Math.round((L.shadow.length || 0) * k); } }
  }

  /* =================================================================
     キーフレーム：ベジェのイージング、キーフレームパネル、モニター上のモーションパス、自動キー
     キー = [クリップ先頭からの秒, 値, 次のキーまでのイージング]
     イージング = 'linear' | 'hold' | 名前 | [x1, y1, x2, y2]（CSS の cubic-bezier と同じ）
     ================================================================= */
  const EASE_BEZ = { linear: [0, 0, 1, 1], easeIn: [0.42, 0, 1, 1], easeOut: [0, 0, 0.58, 1], easeInOut: [0.42, 0, 0.58, 1], back: [0.34, 1.56, 0.64, 1], easy: [0.33, 0, 0.67, 1] };
  const bezCache = new Map();
  function bezierFn(x1, y1, x2, y2) {
    const key = [x1, y1, x2, y2].join(',');
    if (bezCache.has(key)) return bezCache.get(key);
    const bx = (t) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    const by = (t) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
    const dbx = (t) => 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
    const f = (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) { const e = bx(t) - x; const d = dbx(t); if (Math.abs(e) < 1e-6) return by(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
      let lo = 0, hi = 1; t = x;
      for (let i = 0; i < 30; i++) { if (bx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return by(t);
    };
    bezCache.set(key, f);
    return f;
  }
  function easeFn(e) {
    if (Array.isArray(e)) return bezierFn(e[0], e[1], e[2], e[3]);
    if (e === 'hold') return () => 0;
    return EASE[e] || EASE.easeInOut;
  }
  function toBez(e) { if (Array.isArray(e)) return e.slice(); return (EASE_BEZ[e] || EASE_BEZ.easeInOut).slice(); }
  /** キー配列から時刻 lt の値 */
  function kfAt(k, lt) {
    if (lt <= k[0][0]) return k[0][1];
    for (let i = 0; i < k.length - 1; i++) {
      const [t0, v0, e] = k[i], [t1, v1] = k[i + 1];
      if (lt < t1) return v0 + (v1 - v0) * easeFn(e)(clamp((lt - t0) / Math.max(1e-6, t1 - t0), 0, 1));
    }
    return k[k.length - 1][1];
  }
  function setKfObj(obj, prop, lt, v, dur) {
    obj.kf = obj.kf || {};
    const k = obj.kf[prop] = obj.kf[prop] || [];
    lt = clamp(Math.round(lt * fps()) / fps(), 0, dur);
    const i = k.findIndex((x) => Math.abs(x[0] - lt) < 0.5 / fps());
    if (i >= 0) k[i][1] = v; else { k.push([lt, v, P.defaultEase || 'linear']); k.sort((a, b) => a[0] - b[0]); }
  }

  /* ---------- かんたんモーション（ボタン一つで登場・退場の動き） ---------- */
  const MOTION_IN = [['left', '← 左から'], ['right', '右から →'], ['up', '↑ 下から'], ['down', '↓ 上から'], ['zoom', 'ズーム'], ['pop', 'ポン！'], ['spin', '回転'], ['fade', 'フェード']];
  const MOTION_OUT = [['left', '← 左へ'], ['right', '右へ →'], ['up', '↑ 上へ'], ['down', '↓ 下へ'], ['zoom', '縮小'], ['fade', 'フェード']];
  const EASE_OUTQ = [0.16, 1, 0.3, 1], EASE_INQ = [0.7, 0, 0.84, 0];
  function objVal(obj, prop, lt) { const k = obj.kf && obj.kf[prop]; if (k && k.length) return kfAt(k, lt); return obj[prop] == null ? KF_DEFAULT[prop] : obj[prop]; }
  function motionTarget(c) {
    const L = c.type === 'graphic' ? selectedLayer(c) : null;
    return { c, obj: L || c, layer: L };
  }
  function easyMotionHtml(c) {
    const tg = motionTarget(c);
    const who = tg.layer ? `レイヤー「${escapeHtml(tg.layer.name || '')}」` : c.type === 'graphic' ? 'グラフィック全体' : 'このクリップ';
    const nk = tg.obj.kf ? Object.values(tg.obj.kf).reduce((s, k) => s + k.length, 0) : 0;
    const rec = st.rec && st.rec.clipId === c.id && (st.rec.layerId || null) === (tg.layer ? tg.layer.id : null);
    return `<div class="sec motion"><h4><span class="sw" style="background:#ffb020"></span>動きをつける（かんたん）</h4><div class="in">
      <div class="note">対象：<b style="color:var(--ink)">${who}</b>${c.type === 'graphic' && !tg.layer ? '（レイヤーを選ぶとそのレイヤーだけ動かせます）' : ''}</div>
      <div class="mlabel">① 登場の動き（はじめ）</div>
      <div class="mgrid">${MOTION_IN.map(([v, l]) => `<button class="mbtn" data-min="${v}">${l}</button>`).join('')}</div>
      <div class="mlabel">② 退場の動き（おわり）</div>
      <div class="mgrid">${MOTION_OUT.map(([v, l]) => `<button class="mbtn" data-mout="${v}">${l}</button>`).join('')}</div>
      ${field('速さ', `<select id="m-dur">${[[0.3, '速い 0.3秒'], [0.5, 'ふつう 0.5秒'], [0.8, 'ゆっくり 0.8秒'], [1.2, 'とてもゆっくり 1.2秒']].map(([v, l]) => `<option value="${v}"${(st.motionDur || 0.5) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
      <div class="mlabel">③ 自分で動きを作る</div>
      <div class="note">「記録スタート」→ 再生ヘッドを進める → 画面の素材をドラッグ・拡大。動かした分が自動でキーフレームになり、なめらかにつながります。</div>
      <div class="btnrow">${rec ? '<button class="btn sm primary" id="m-recend">■ 記録を終わる</button>' : '<button class="btn sm primary" id="m-rec">● ここから記録スタート</button>'}<button class="btn sm" id="m-play">▶ 動きを見る</button><button class="btn sm danger" id="m-clear"${nk ? '' : ' disabled'}>動きを消す${nk ? `（◆${nk}）` : ''}</button></div>
    </div></div>`;
  }
  /** 登場（kind='in'）／退場（'out'）の動きを、キーフレームとして入れる */
  function applyMotion(c, obj, kind, dir, d) {
    const W = P.width, H = P.height;
    d = snapFrame(Math.max(1 / fps(), Math.min(d, c.dur * 0.9)));
    const t0 = kind === 'in' ? 0 : snapFrame(c.dur - d), t1 = kind === 'in' ? d : c.dur;
    const at = kind === 'in' ? t1 : t0;
    const base = {}; for (const p of KF_PROPS) base[p] = objVal(obj, p, at);
    const off = {};
    if (dir === 'left') { off.x = base.x - W * 0.7; off.opacity = 0; }
    if (dir === 'right') { off.x = base.x + W * 0.7; off.opacity = 0; }
    if (dir === 'up') { off.y = kind === 'in' ? base.y + H * 0.45 : base.y - H * 0.45; off.opacity = 0; }
    if (dir === 'down') { off.y = kind === 'in' ? base.y - H * 0.45 : base.y + H * 0.45; off.opacity = 0; }
    if (dir === 'zoom') { off.scale = base.scale * (kind === 'in' ? 0.2 : 0.1); off.opacity = 0; }
    if (dir === 'spin') { off.rotation = base.rotation - 360; off.scale = base.scale * 0.3; off.opacity = 0; }
    if (dir === 'fade') off.opacity = 0;
    obj.kf = obj.kf || {};
    const put = (prop, keys) => {
      const k = (obj.kf[prop] || []).filter((x) => x[0] < t0 - 0.5 / fps() || x[0] > t1 + 0.5 / fps());
      // まだキーがない項目は、範囲外の値が変わらないように基準の値を残す
      obj.kf[prop] = k.concat(keys.map((x) => [snapFrame(x[0]), x[1], x[2]])).sort((a, b) => a[0] - b[0]);
    };
    if (dir === 'pop' && kind === 'in') {
      put('scale', [[0, 0, EASE_OUTQ], [d * 0.65, base.scale * 1.15, [0.33, 0, 0.67, 1]], [d, base.scale, [0.33, 0, 0.67, 1]]]);
      put('opacity', [[0, 0, 'linear'], [Math.min(d * 0.3, d), base.opacity, 'linear']]);
    } else {
      for (const [p, v] of Object.entries(off)) {
        if (kind === 'in') put(p, [[t0, v, p === 'opacity' ? [0.33, 0, 0.67, 1] : EASE_OUTQ], [t1, base[p], [0.33, 0, 0.67, 1]]]);
        else put(p, [[t0, base[p], p === 'opacity' ? [0.33, 0, 0.67, 1] : EASE_INQ], [t1, v, [0.33, 0, 0.67, 1]]]);
      }
    }
    if (obj === c) delete c.anim;
    return { t0, t1 };
  }
  function previewRange(c, a, b) {
    pause();
    seek(clamp(c.start + a - 0.15, 0, duration()));
    play();
    clearTimeout(previewRange.tm);
    previewRange.tm = setTimeout(() => { if (st.playing) pause(); }, Math.max(400, (b - a + 0.6) * 1000));
  }
  function startMotionRec(c) {
    const tg = motionTarget(c);
    pause(); clearTimeout(previewRange.tm);
    pushUndo();
    if (st.time < c.start || st.time >= clipEnd(c)) seek(c.start);
    const lt = clamp(st.time - c.start, 0, c.dur);
    for (const p of KF_PROPS) {
      // 動かす前の値を「始まり」として記録（不透明度は変えたときだけ）
      if (p === 'opacity' && !(tg.obj.kf && tg.obj.kf.opacity)) continue;
      setKfObj(tg.obj, p, lt, objVal(tg.obj, p, lt), c.dur);
    }
    st.rec = { clipId: c.id, layerId: tg.layer ? tg.layer.id : null };
    st.autoKey = true; $('#kf-auto').classList.add('on');
    $('#kfstrip').classList.remove('hidden');
    showRecBanner();
    changed({ props: true });
  }
  function stopMotionRec() {
    if (!st.rec) return;
    const c = clipById(st.rec.clipId);
    if (c) {
      const obj = st.rec.layerId ? (c.layers || []).find((x) => x.id === st.rec.layerId) : c;
      // 記録したキーは、なめらかにつながるように緩急（イージーイーズ）をつける
      if (obj && obj.kf) for (const [p, k] of Object.entries(obj.kf)) {
        if (k.length && k.every((x) => Math.abs(x[1] - k[0][1]) < 1e-6)) { delete obj.kf[p]; obj[p] = k[0][1]; continue; }
        for (const x of k) if (x[2] === 'linear' || x[2] == null) x[2] = [0.33, 0, 0.67, 1];
      }
      if (obj && obj.kf && !Object.keys(obj.kf).length) delete obj.kf;
    }
    st.rec = null;
    st.autoKey = false; $('#kf-auto').classList.remove('on');
    showRecBanner();
    changed({ props: true });
    toast('動きを記録しました。▶ で確認できます');
  }
  function showRecBanner() {
    let b = $('#rec-banner');
    if (!st.rec) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div'); b.id = 'rec-banner';
      b.innerHTML = '<span class="dot"></span><span class="tx">動きを記録中：再生ヘッドを進めて、画面の素材を動かしてください</span><button class="btn sm" data-rstep="-0.5">−0.5秒</button><button class="btn sm" data-rstep="0.5">＋0.5秒</button><button class="btn sm primary" data-rend>完了</button>';
      $('#mon-stage').appendChild(b);
      b.addEventListener('click', (e) => {
        const s = e.target.closest('[data-rstep]');
        if (s) { const c = clipById(st.rec && st.rec.clipId); seek(clamp(st.time + +s.dataset.rstep, c ? c.start : 0, c ? clipEnd(c) - 1 / fps() : duration())); return; }
        if (e.target.closest('[data-rend]')) stopMotionRec();
      });
    }
  }
  function bindEasyMotion(c) {
    const box = $('.sec.motion', insp); if (!box) return;
    const dur = () => { const v = +($('#m-dur', box) || {}).value || 0.5; st.motionDur = v; return v; };
    const go = (kind, dir) => {
      const tg = motionTarget(c);
      pushUndo();
      const r = applyMotion(c, tg.obj, kind, dir, dur());
      changed({ props: true });
      previewRange(c, r.t0, r.t1);
    };
    $$('[data-min]', box).forEach((b) => b.addEventListener('click', () => go('in', b.dataset.min)));
    $$('[data-mout]', box).forEach((b) => b.addEventListener('click', () => go('out', b.dataset.mout)));
    $('#m-dur', box).addEventListener('change', dur);
    const rb = $('#m-rec', box); if (rb) rb.addEventListener('click', () => startMotionRec(c));
    const re = $('#m-recend', box); if (re) re.addEventListener('click', () => stopMotionRec());
    $('#m-play', box).addEventListener('click', () => previewRange(c, 0, c.dur));
    $('#m-clear', box).addEventListener('click', () => {
      const o = motionTarget(c).obj; if (!o.kf) return;
      pushUndo();
      // 動きの「止まっている状態」（クリップの真ん中の値）を残す
      const lt = c.dur / 2;
      for (const p of KF_PROPS) if (o.kf[p] && o.kf[p].length) { o[p] = kfAt(o.kf[p], lt); delete o.kf[p]; }
      if (!Object.keys(o.kf).length) delete o.kf;
      changed({ props: true }); toast('動きを消しました');
    });
  }

  /* ---------- 対象（クリップ or グラフィックのレイヤー） ---------- */
  const KF_LABEL = { x: '位置 X', y: '位置 Y', scale: 'スケール', rotation: '回転', opacity: '不透明度' };
  function kfTarget() {
    const c = soleClip();
    if (!c || c.type === 'audio') return null;
    const L = selectedLayer(c);
    return { c, obj: L || c, layer: L };
  }
  st.kfSel = new Set();
  st.autoKey = false;

  /* ---------- キーフレームパネル ---------- */
  const kfc = $('#kf-canvas'), kctx = kfc.getContext('2d');
  const KF_ROW = 17, KF_LABEL_W = 78;
  let kfHits = [];
  function drawKfStrip() {
    const box = $('#kfstrip');
    if (box.classList.contains('hidden')) return;
    const tg = kfTarget();
    const dpr = window.devicePixelRatio || 1;
    const cw = kfc.clientWidth, ch = KF_ROW * KF_PROPS.length + 16;
    kfc.style.height = ch + 'px';
    if (kfc.width !== Math.round(cw * dpr) || kfc.height !== Math.round(ch * dpr)) { kfc.width = Math.round(cw * dpr); kfc.height = Math.round(ch * dpr); }
    kctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kctx.clearRect(0, 0, cw, ch);
    kctx.fillStyle = '#181818'; kctx.fillRect(0, 0, cw, ch);
    $('#kf-title').textContent = tg ? (tg.layer ? `レイヤー「${tg.layer.name}」` : clipLabel(tg.c)) : 'クリップを選ぶと、ここにキーフレームが出ます';
    kfHits = [];
    if (!tg) return;
    const { c, obj } = tg;
    const x0 = KF_LABEL_W, x1 = cw - 10, tw = x1 - x0;
    const tx = (lt) => x0 + clamp(lt / c.dur, 0, 1) * tw;
    kctx.font = '11px system-ui,sans-serif'; kctx.textBaseline = 'middle';
    KF_PROPS.forEach((prop, r) => {
      const y = 8 + r * KF_ROW + KF_ROW / 2;
      kctx.fillStyle = r % 2 ? '#1c1c1c' : '#202020'; kctx.fillRect(0, y - KF_ROW / 2, cw, KF_ROW);
      const k = obj.kf && obj.kf[prop];
      kctx.fillStyle = k && k.length ? '#ddd' : '#777'; kctx.fillText(KF_LABEL[prop], 8, y);
      if (!k || !k.length) return;
      // 区間の線（イージングの種類で色分け）
      for (let i = 0; i < k.length - 1; i++) {
        const e = k[i][2];
        kctx.strokeStyle = e === 'hold' ? '#e5484d' : (e === 'linear' || (Array.isArray(e) && e.join() === '0,0,1,1')) ? '#777' : '#4fa3f7';
        kctx.lineWidth = 2; kctx.beginPath(); kctx.moveTo(tx(k[i][0]), y); kctx.lineTo(tx(k[i + 1][0]), y); kctx.stroke();
      }
      k.forEach((key, i) => {
        const x = tx(key[0]);
        const sel = st.kfSel.has(key);
        const e = key[2], prevE = i > 0 ? k[i - 1][2] : null;
        kctx.fillStyle = sel ? '#ffd84d' : '#d0d0d0'; kctx.strokeStyle = '#000'; kctx.lineWidth = 1;
        kctx.beginPath();
        if (e === 'hold') kctx.rect(x - 5, y - 5, 10, 10);
        else {
          const easedOut = Array.isArray(e) ? e[1] === 0 && e[0] > 0.05 : /easeOut|easeInOut|easy/.test(e);
          const easedIn = prevE && (Array.isArray(prevE) ? prevE[3] === 1 && prevE[2] < 0.95 : /easeIn|easeInOut|easy/.test(prevE));
          // 左右の形：イーズありは丸、なしはとがった形
          kctx.moveTo(x, y - 6);
          if (easedOut) kctx.arc(x, y, 6, -Math.PI / 2, Math.PI / 2); else { kctx.lineTo(x + 6, y); kctx.lineTo(x, y + 6); }
          if (easedIn) kctx.arc(x, y, 6, Math.PI / 2, Math.PI * 1.5); else { kctx.lineTo(x - 6, y); kctx.closePath(); }
        }
        kctx.fill(); kctx.stroke();
        kfHits.push({ x, y, key, prop, arr: k, i });
      });
    });
    // 再生ヘッド
    const lt = st.time - c.start;
    if (lt >= 0 && lt <= c.dur) { kctx.fillStyle = '#e5484d'; kctx.fillRect(Math.round(tx(lt)), 0, 1, ch); }
  }
  function kfHitAt(e) {
    const r = kfc.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 9;
    for (const h of kfHits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } }
    return { hit: best, x, y };
  }
  kfc.addEventListener('pointerdown', (e) => {
    const tg = kfTarget(); if (!tg) return;
    const { hit, x } = kfHitAt(e);
    const cw = kfc.clientWidth, x0 = KF_LABEL_W, tw = cw - 10 - x0;
    const timeAt = (px) => clamp((px - x0) / tw, 0, 1) * tg.c.dur;
    if (!hit) {
      if (x > x0) { pause(); seek(tg.c.start + timeAt(x)); }
      if (!e.shiftKey) st.kfSel.clear();
      drawKfStrip();
      return;
    }
    if (e.button === 2) return;
    if (e.shiftKey) { if (st.kfSel.has(hit.key)) st.kfSel.delete(hit.key); else st.kfSel.add(hit.key); }
    else if (!st.kfSel.has(hit.key)) st.kfSel = new Set([hit.key]);
    pause(); seek(tg.c.start + hit.key[0]);
    // ドラッグで時刻を動かす
    const sx = e.clientX, orig = new Map([...st.kfSel].map((k) => [k, k[0]]));
    let moved = false;
    const snap0 = snapshot();
    kfc.setPointerCapture(e.pointerId);
    kfc.onpointermove = (ev) => {
      const dt = (ev.clientX - sx) / tw * tg.c.dur;
      if (!moved && Math.abs(ev.clientX - sx) < 3) return;
      moved = true;
      for (const [k, t0] of orig) k[0] = clamp(Math.round((t0 + dt) * fps()) / fps(), 0, tg.c.dur);
      for (const arr of Object.values(tg.obj.kf || {})) arr.sort((a, b) => a[0] - b[0]);
      layerCache.delete(tg.obj.id); requestDraw(); drawKfStrip();
    };
    kfc.onpointerup = () => {
      kfc.onpointermove = null; kfc.onpointerup = null;
      if (moved) { undoStack.push(snap0); redoStack.length = 0; changed({ props: true, light: true }); }
      drawKfStrip();
    };
  });
  kfc.addEventListener('dblclick', (e) => { const { hit } = kfHitAt(e); if (hit) easeEditor(); });
  kfc.addEventListener('contextmenu', (e) => { e.preventDefault(); const { hit } = kfHitAt(e); if (!hit) return; if (!st.kfSel.has(hit.key)) st.kfSel = new Set([hit.key]); easeEditor(); });

  /** 選んだキー（なければ再生ヘッドに一番近いキー）に関係する区間を返す */
  function selectedKeyInfos() {
    const tg = kfTarget(); if (!tg || !tg.obj.kf) return [];
    let keys = [...st.kfSel];
    if (!keys.length) {
      const lt = st.time - tg.c.start;
      for (const arr of Object.values(tg.obj.kf)) { const k = arr.find((x) => Math.abs(x[0] - lt) < 0.5 / fps()); if (k) keys.push(k); }
    }
    const out = [];
    for (const [prop, arr] of Object.entries(tg.obj.kf)) arr.forEach((k, i) => { if (keys.includes(k)) out.push({ prop, arr, i, k }); });
    return out;
  }
  /** イージーイーズ（F9）：in / out / both */
  function easyEase(mode) {
    const infos = selectedKeyInfos();
    if (!infos.length) return toast('キーフレームを選んでください（キーフレームパネルでクリック、または再生ヘッドをキーに合わせる）');
    pushUndo();
    for (const { arr, i } of infos) {
      if (mode !== 'in' && i < arr.length - 1) { const b = toBez(arr[i][2] === 'hold' ? 'linear' : arr[i][2]); b[0] = 0.33; b[1] = 0; arr[i][2] = b; }
      if (mode !== 'out' && i > 0) { const b = toBez(arr[i - 1][2] === 'hold' ? 'linear' : arr[i - 1][2]); b[2] = 0.67; b[3] = 1; arr[i - 1][2] = b; }
    }
    changed({ props: true, light: true });
    toast(mode === 'in' ? 'イーズイン（入りをゆっくり）' : mode === 'out' ? 'イーズアウト（出をゆっくり）' : 'イージーイーズ（前後をゆっくり）');
  }
  function setEaseSelected(e) {
    const infos = selectedKeyInfos(); if (!infos.length) return toast('キーフレームを選んでください');
    pushUndo();
    for (const { arr, i } of infos) {
      if (e === 'hold' || e === 'linear') { arr[i][2] = e; if (e === 'linear' && i > 0 && Array.isArray(arr[i - 1][2])) { arr[i - 1][2][2] = 1; arr[i - 1][2][3] = 1; } }
      else arr[i][2] = e;
    }
    changed({ props: true, light: true });
  }
  function deleteSelectedKeys() {
    const infos = selectedKeyInfos(); if (!infos.length) return;
    pushUndo();
    const tg = kfTarget();
    for (const { prop, k } of infos) { const arr = tg.obj.kf[prop]; const j = arr.indexOf(k); if (j >= 0) arr.splice(j, 1); if (!arr.length) { tg.obj[prop] = kfAt([k], 0); delete tg.obj.kf[prop]; } }
    st.kfSel.clear();
    changed({ props: true });
  }

  /** イージングのカーブ編集（グラフのハンドルをドラッグして緩急を調整） */
  function easeEditor() {
    const infos = selectedKeyInfos().filter((x) => x.i < x.arr.length - 1);
    if (!infos.length) return toast('次のキーフレームとの間（区間）がありません。2つ以上キーを打ってから調整してください');
    let b = toBez(infos[0].k[2] === 'hold' ? 'linear' : infos[0].k[2]);
    const m = openModal('イージング（緩急）の調整', `
      <p class="note" style="font-size:11.5px">横＝時間、縦＝動いた量。2つの丸をドラッグして、動き出し（左下）と止まり方（右上）の緩急を決めます。<br>下の速さのグラフは、山の高い所ほど速く動きます。</p>
      <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
        <canvas id="ez-c" width="520" height="520" style="width:260px;height:260px;background:#151515;border-radius:8px;touch-action:none;cursor:pointer"></canvas>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:150px">
          <button class="btn sm" data-ez="easy">イージーイーズ</button>
          <button class="btn sm" data-ez="easeOut">ゆっくり止まる</button>
          <button class="btn sm" data-ez="easeIn">ゆっくり動き出す</button>
          <button class="btn sm" data-ez="easeInOut">強めのイーズ</button>
          <button class="btn sm" data-ez="back">行き過ぎて戻る</button>
          <button class="btn sm" data-ez="linear">一定の速さ（リニア）</button>
          <button class="btn sm" data-ez="hold">停止（パッと切り替え）</button>
          <div class="unit" id="ez-v" style="font-family:ui-monospace,monospace;margin-top:4px"></div>
          <canvas id="ez-s" width="300" height="100" style="width:150px;height:50px;background:#151515;border-radius:6px"></canvas>
        </div>
      </div>
      <p class="unit">選んだ区間：${infos.length} 個（${[...new Set(infos.map((x) => KF_LABEL[x.prop]))].join('・')}）</p>
    `, [['キャンセル', null], ['適用', 'go', true]], { width: 520 });
    const cv = $('#ez-c', m.el), g = cv.getContext('2d'), sv = $('#ez-s', m.el), sg = sv.getContext('2d');
    let hold = false;
    const S = 520, pad = 90, span = S - pad * 2;
    const toPx = (x, y) => [pad + x * span, S - pad - y * span];
    const draw = () => {
      g.clearRect(0, 0, S, S);
      g.strokeStyle = '#333'; g.lineWidth = 2; g.strokeRect(pad, pad, span, span);
      g.strokeStyle = '#2a2a2a'; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(pad + span * i / 4, pad); g.lineTo(pad + span * i / 4, S - pad); g.moveTo(pad, pad + span * i / 4); g.lineTo(S - pad, pad + span * i / 4); g.stroke(); }
      const [ax, ay] = toPx(0, 0), [bx2, by2] = toPx(1, 1), [p1x, p1y] = toPx(b[0], b[1]), [p2x, p2y] = toPx(b[2], b[3]);
      if (hold) { g.strokeStyle = '#e5484d'; g.lineWidth = 6; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx2, ay); g.lineTo(bx2, by2); g.stroke(); }
      else {
        g.strokeStyle = '#888'; g.lineWidth = 3; g.beginPath(); g.moveTo(ax, ay); g.lineTo(p1x, p1y); g.moveTo(bx2, by2); g.lineTo(p2x, p2y); g.stroke();
        g.strokeStyle = '#4fa3f7'; g.lineWidth = 6; g.beginPath(); g.moveTo(ax, ay); g.bezierCurveTo(p1x, p1y, p2x, p2y, bx2, by2); g.stroke();
        for (const [x, y] of [[p1x, p1y], [p2x, p2y]]) { g.fillStyle = '#ffd84d'; g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.fill(); }
      }
      $('#ez-v', m.el).textContent = hold ? '停止' : `(${b.map((v) => v.toFixed(2)).join(', ')})`;
      // 速さのグラフ
      sg.clearRect(0, 0, 300, 100);
      if (!hold) {
        const f = bezierFn(b[0], b[1], b[2], b[3]);
        const vs = []; for (let i = 0; i <= 60; i++) { const x = i / 60, dx = 1 / 120; vs.push((f(Math.min(1, x + dx)) - f(Math.max(0, x - dx))) / (Math.min(1, x + dx) - Math.max(0, x - dx))); }
        const mx = Math.max(1.5, ...vs.map(Math.abs));
        sg.fillStyle = 'rgba(79,163,247,.35)'; sg.strokeStyle = '#4fa3f7'; sg.lineWidth = 2; sg.beginPath(); sg.moveTo(0, 100);
        vs.forEach((v, i) => sg.lineTo(i / 60 * 300, 100 - clamp(v / mx, -0.2, 1) * 90)); sg.lineTo(300, 100); sg.closePath(); sg.fill(); sg.stroke();
      }
    };
    draw();
    let drag = -1;
    cv.addEventListener('pointerdown', (e) => {
      if (hold) return;
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * 2, y = (e.clientY - r.top) * 2;
      const d1 = Math.hypot(x - toPx(b[0], b[1])[0], y - toPx(b[0], b[1])[1]), d2 = Math.hypot(x - toPx(b[2], b[3])[0], y - toPx(b[2], b[3])[1]);
      drag = d1 <= d2 ? 0 : 2; cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * 2, y = (e.clientY - r.top) * 2;
      b[drag] = +clamp((x - pad) / span, 0, 1).toFixed(3); b[drag + 1] = +clamp((S - pad - y) / span, -1, 2).toFixed(3);
      draw();
    });
    cv.addEventListener('pointerup', () => { drag = -1; });
    $$('[data-ez]', m.el).forEach((btn) => btn.addEventListener('click', () => { const v = btn.dataset.ez; hold = v === 'hold'; if (!hold) b = toBez(v); draw(); }));
    m.result.then((r) => {
      if (r !== 'go') return;
      pushUndo();
      for (const { k } of infos) k[2] = hold ? 'hold' : b.slice();
      changed({ props: true, light: true });
    });
  }

  /* ---------- モニター上のモーションパス ---------- */
  let pathKeys = [];
  /** 対象の「中心」のフレーム座標（時刻 t） */
  function targetCenter(tg, t) {
    const c = tg.c, W = P.width, H = P.height;
    const ex = kfValue(c, 'x', t), ey = kfValue(c, 'y', t);
    if (!tg.layer) {
      const r = lastRects[c.id];
      const off = r ? { x: r.x + r.w / 2 - (W / 2 + kfValue(c, 'x', st.time)), y: r.y + r.h / 2 - (H / 2 + kfValue(c, 'y', st.time)) } : { x: 0, y: 0 };
      return { x: W / 2 + ex + off.x, y: H / 2 + ey + off.y };
    }
    const gk = kfValue(c, 'scale', t) / 100, lt = t - c.start;
    return { x: W / 2 + ex + layerVal(tg.layer, 'x', lt) * gk, y: H / 2 + ey + layerVal(tg.layer, 'y', lt) * gk };
  }
  function drawMotionPath() {
    pathKeys = [];
    const tg = kfTarget(); if (!tg || st.playing) return;
    const kf = tg.obj.kf || {};
    const kx = kf.x || [], ky = kf.y || [];
    if (kx.length + ky.length < 2) return;
    const c = tg.c, W = P.width;
    const lw = Math.max(2, W / 700);
    octx.save();
    octx.setLineDash([lw * 3, lw * 3]); octx.strokeStyle = 'rgba(255,216,77,.85)'; octx.lineWidth = lw;
    octx.beginPath();
    const n = Math.max(2, Math.ceil(c.dur * 15));
    for (let i = 0; i <= n; i++) { const p = targetCenter(tg, c.start + c.dur * i / n); i ? octx.lineTo(p.x, p.y) : octx.moveTo(p.x, p.y); }
    octx.stroke(); octx.setLineDash([]);
    // 途中の点（等間隔の時間）＝速さが見える
    octx.fillStyle = 'rgba(255,216,77,.6)';
    for (let i = 0; i <= n; i += 1) { const p = targetCenter(tg, c.start + c.dur * i / n); octx.fillRect(p.x - lw, p.y - lw, lw * 2, lw * 2); }
    const times = [...new Set(kx.concat(ky).map((k) => +k[0].toFixed(4)))];
    const s = Math.max(10, W / 110);
    for (const lt of times) {
      const p = targetCenter(tg, c.start + lt);
      const sel = kx.concat(ky).some((k) => Math.abs(k[0] - lt) < 1e-3 && st.kfSel.has(k));
      octx.fillStyle = sel ? '#ffd84d' : '#fff'; octx.strokeStyle = '#000'; octx.lineWidth = lw;
      octx.beginPath(); octx.moveTo(p.x, p.y - s); octx.lineTo(p.x + s, p.y); octx.lineTo(p.x, p.y + s); octx.lineTo(p.x - s, p.y); octx.closePath(); octx.fill(); octx.stroke();
      pathKeys.push({ lt, x: p.x, y: p.y });
    }
    const now = targetCenter(tg, st.time);
    octx.strokeStyle = '#e5484d'; octx.lineWidth = lw * 1.5; octx.beginPath(); octx.arc(now.x, now.y, s * 0.8, 0, Math.PI * 2); octx.stroke();
    octx.restore();
  }
  /** モーションパスのキーをドラッグ。処理したら true */
  function pathPointerDown(e, pt) {
    const tg = kfTarget(); if (!tg || !pathKeys.length) return false;
    const s = Math.max(14, P.width / 80);
    const hit = pathKeys.find((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < s);
    if (!hit) return false;
    // 動きの記録中、または素材そのもの（今の位置）をつかんだときは、素材のドラッグを優先
    if (st.rec) return false;
    const cr = tg.layer ? (layerRects[tg.c.id] || {})[tg.layer.id] : lastRects[tg.c.id];
    if (cr && Math.abs(hit.lt - (st.time - tg.c.start)) > 0.5 / fps()) {
      const ccx = cr.cx != null ? cr.cx : cr.x + cr.w / 2, ccy = cr.cy != null ? cr.cy : cr.y + cr.h / 2;
      if (Math.hypot(ccx - pt.x, ccy - pt.y) < s * 1.5) return false;
    }
    const obj = tg.obj, kf = obj.kf;
    const kx = (kf.x || []).find((k) => Math.abs(k[0] - hit.lt) < 1e-3), ky = (kf.y || []).find((k) => Math.abs(k[0] - hit.lt) < 1e-3);
    st.kfSel = new Set([kx, ky].filter(Boolean));
    seek(tg.c.start + hit.lt);
    const div = tg.layer ? kfValue(tg.c, 'scale', tg.c.start + hit.lt) / 100 : 1;
    const x0 = kx ? kx[1] : null, y0 = ky ? ky[1] : null;
    const snap0 = snapshot(); let moved = false;
    overlay.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const q = monitorPoint(ev); moved = true;
      if (kx) kx[1] = Math.round(x0 + (q.x - pt.x) / div);
      if (ky) ky[1] = Math.round(y0 + (q.y - pt.y) / div);
      requestDraw(); drawKfStrip();
    };
    const up = () => { overlay.removeEventListener('pointermove', mv); overlay.removeEventListener('pointerup', up); if (moved) { undoStack.push(snap0); redoStack.length = 0; changed({ props: true, light: true }); } };
    overlay.addEventListener('pointermove', mv); overlay.addEventListener('pointerup', up);
    return true;
  }

  // パネルのボタン
  $('#kf-toggle').addEventListener('click', () => { $('#kfstrip').classList.toggle('hidden'); $('#kf-toggle').classList.toggle('on', !$('#kfstrip').classList.contains('hidden')); try { localStorage.setItem('cc-kfstrip', $('#kfstrip').classList.contains('hidden') ? '0' : '1'); } catch (e) { /* ignore */ } layoutMonitor(); drawKfStrip(); });
  $('#kf-auto').addEventListener('click', () => { st.autoKey = !st.autoKey; $('#kf-auto').classList.toggle('on', st.autoKey); toast(st.autoKey ? '自動キー：オン（動かすと再生ヘッドの位置にキーフレームが打たれます）' : '自動キー：オフ'); });
  $('#kf-add').addEventListener('click', () => {
    const tg = kfTarget(); if (!tg) return toast('クリップを選んでください');
    pushUndo();
    const lt = st.time - tg.c.start;
    for (const p of ['x', 'y', 'scale']) setKfObj(tg.obj, p, lt, tg.layer ? layerVal(tg.layer, p, lt) : kfValue(tg.c, p, st.time), tg.c.dur);
    changed({ props: true, light: true }); toast('位置とスケールのキーフレームを打ちました');
  });
  $('#kf-easy').addEventListener('click', () => easyEase('both'));
  $('#kf-curve').addEventListener('click', () => { if (!st.kfSel.size) { const infos = selectedKeyInfos(); st.kfSel = new Set(infos.map((x) => x.k)); } easeEditor(); });
  $('#kf-del').addEventListener('click', deleteSelectedKeys);
  try { if (localStorage.getItem('cc-kfstrip') === '1') { $('#kfstrip').classList.remove('hidden'); $('#kf-toggle').classList.add('on'); } } catch (e) { /* ignore */ }

  /* =================================================================
     インスペクター：グラフィック（レイヤーパネル・テキストの塗り/エッジ/シャドウ/テクスチャ）
     ================================================================= */
  function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, path, v) {
    const ks = path.split('.'); let cur = o;
    for (let i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] == null) cur[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; cur = cur[ks[i]]; }
    cur[ks[ks.length - 1]] = v;
  }
  const L_ICON = { text: 'T', shape: '■', image: '▣' };
  function kfBtnL(c, L, prop) {
    const on = !!(L.kf && L.kf[prop] && L.kf[prop].length), lt = st.time - c.start;
    const here = on && L.kf[prop].some((k) => Math.abs(k[0] - lt) < 0.5 / fps());
    return `<button class="kfb${on ? ' on' : ''}${here ? ' here' : ''}" data-lkf="${prop}" title="${on ? (here ? 'このキーフレームを削除' : '再生ヘッドにキーフレームを追加') : 'キーフレームを有効にする'}">${here ? '◆' : '◇'}</button>`;
  }
  function paintEditor(label, path, paint) {
    paint = paint || solidPaint('#ffffff');
    const t = paint.type || 'solid';
    let h = field(label, `<select data-ptype="${path}"><option value="solid"${t === 'solid' ? ' selected' : ''}>単色</option><option value="linear"${t === 'linear' ? ' selected' : ''}>グラデーション（直線）</option><option value="radial"${t === 'radial' ? ' selected' : ''}>グラデーション（円形）</option></select>`);
    if (t === 'solid') h += colorField('　色', path + '.color', paint.color || '#ffffff');
    else {
      const stops = paint.stops || [];
      const css = `linear-gradient(90deg,${stops.map(([p, col]) => `${col} ${Math.round(p * 100)}%`).join(',')})`;
      h += `<div class="gbar" style="background:${css}"></div>`;
      if (t === 'linear') h += field('　角度', scrub('L.' + path + '.angle', paint.angle == null ? 90 : paint.angle, { step: 1, min: -360, max: 360, unit: '°' }));
      stops.forEach(([p, col], i) => {
        h += `<div class="gstop">${colorField(`　${i + 1}`, `${path}.stops.${i}.1`, col)}<span class="gpos">${scrub(`L.${path}.stops.${i}.0`, p * 100, { step: 1, min: 0, max: 100, unit: '%' })}</span>${stops.length > 2 ? `<button class="btn sm" data-gdel="${path}" data-gi="${i}" title="この色を消す">×</button>` : ''}</div>`;
      });
      h += `<div class="btnrow"><button class="btn sm" data-gadd="${path}">＋ 色を追加</button></div>`;
    }
    return h;
  }
  function edgesEditor(L) {
    const ss = L.strokes || [];
    let h = `<div class="sec"><h4>エッジ（縁）<span class="unit" style="margin-left:6px;font-weight:400">上が内側</span><button class="btn sm" data-sadd style="margin-left:auto;padding:1px 6px">＋ エッジ</button></h4><div class="in">`;
    if (!ss.length) h += '<div class="note">エッジなし。「＋ エッジ」で縁取りを追加できます（何本でも重ねられます）。</div>';
    ss.forEach((s, i) => {
      h += `<div class="edge"><div class="edge-h"><label><input type="checkbox" data-son="${i}"${s.on !== false ? ' checked' : ''}> エッジ ${i + 1}</label>
        <span style="margin-left:auto"><button class="btn sm" data-smove="${i}" data-dir="-1" title="内側へ">↑</button><button class="btn sm" data-smove="${i}" data-dir="1" title="外側へ">↓</button><button class="btn sm danger" data-sdel="${i}">×</button></span></div>
        ${field('太さ', scrub(`L.strokes.${i}.width`, s.width || 0, { step: 0.5, min: 0, max: 200, unit: 'px', dec: 1 }))}
        ${paintEditor('色', `strokes.${i}.paint`, s.paint)}
        ${field('形状', `<select data-sjoin="${i}"><option value="round"${(s.join || 'round') === 'round' ? ' selected' : ''}>丸</option><option value="miter"${s.join === 'miter' ? ' selected' : ''}>角（とがる）</option><option value="bevel"${s.join === 'bevel' ? ' selected' : ''}>面取り</option></select>`)}
        ${field('不透明度', scrub(`L.strokes.${i}.opacity`, s.opacity == null ? 100 : s.opacity, { step: 1, min: 0, max: 100, unit: '%' }))}
      </div>`;
    });
    return h + '</div></div>';
  }
  function shadowEditor(L) {
    const s = L.shadow || {};
    return `<div class="sec"><h4>シャドウ（影）<label style="margin-left:auto;font-weight:400"><input type="checkbox" data-shon${s.on ? ' checked' : ''}> オン</label></h4><div class="in${s.on ? '' : ' dim'}">
      ${paintEditor('色', 'shadow.paint', s.paint)}
      ${field('不透明度', scrub('L.shadow.opacity', s.opacity == null ? 50 : s.opacity, { step: 1, min: 0, max: 100, unit: '%' }))}
      ${field('距離', scrub('L.shadow.distance', s.distance || 0, { step: 1, min: 0, max: 500, unit: 'px' }))}
      ${field('角度', scrub('L.shadow.angle', s.angle == null ? 135 : s.angle, { step: 1, min: -360, max: 360, unit: '°' }))}
      ${field('長さ', scrub('L.shadow.length', s.length || 0, { step: 1, min: 0, max: 240, unit: 'px' }))}
      ${field('硬さ', scrub('L.shadow.hardness', s.hardness == null ? 70 : s.hardness, { step: 1, min: 0, max: 100, unit: '%' }))}
      <div class="note">長さ＝影を伸ばして立体風に。硬さ 100％でくっきり、下げるほどぼける。</div>
    </div></div>`;
  }
  function textureEditor(L) {
    const t = L.texture || {};
    const imgs = P.media.filter((m) => m.type === 'image');
    return `<div class="sec"><h4>テクスチャ<label style="margin-left:auto;font-weight:400"><input type="checkbox" data-txon${t.on ? ' checked' : ''}> オン</label></h4><div class="in${t.on ? '' : ' dim'}">
      ${field('種類', `<select data-txkind>${TEXTURES.map(([v, l]) => `<option value="${v}"${t.kind === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${t.kind === 'image' ? field('画像', `<select data-tximg><option value="">（プロジェクトの画像を選ぶ）</option>${imgs.map((m) => `<option value="${m.id}"${t.mediaId === m.id ? ' selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>`) : ''}
      ${field('大きさ', scrub('L.texture.scale', t.scale || 100, { step: 1, min: 10, max: 1000, unit: '%' }))}
      ${field('濃さ', scrub('L.texture.opacity', t.opacity == null ? 60 : t.opacity, { step: 1, min: 0, max: 100, unit: '%' }))}
      <div class="note">文字の塗りの上に模様や画像を重ねます（縁と影には乗りません）。</div>
    </div></div>`;
  }
  function graphicInspectorHtml(c) {
    const L = selectedLayer(c);
    const rows = (c.layers || []).slice().reverse().map((x) => `
      <div class="lrow${L && L.id === x.id ? ' on' : ''}${x.visible === false ? ' off' : ''}" data-lsel="${x.id}">
        <button class="lb" data-lvis="${x.id}" title="表示／非表示">${x.visible === false ? '◌' : '👁'}</button>
        <button class="lb" data-llock="${x.id}" title="ロック（モニターで動かないように）">${x.locked ? '🔒' : '🔓'}</button>
        <span class="lic">${L_ICON[x.kind]}</span>
        <span class="lname" title="ダブルクリックで名前を変更">${escapeHtml(x.name || x.kind)}${x.kind === 'text' ? `<span class="unit">　${escapeHtml(String(x.text).replace(/\n/g, ' ').slice(0, 14))}</span>` : ''}</span>
        ${x.kf && Object.keys(x.kf).length ? '<span class="lkf" title="キーフレームあり">◆</span>' : ''}
      </div>`).join('');
    let h = `<div class="sec"><h4>レイヤー<span class="unit" style="margin-left:6px;font-weight:400">上ほど手前</span></h4><div class="in">
      <div class="layers">${rows || '<div class="note">レイヤーがありません</div>'}</div>
      <div class="btnrow"><button class="btn sm" data-ladd="text">＋ テキスト</button><span class="addshape"><button class="btn sm" data-ladd="shape">＋ シェイプ</button><select id="L-addshape" title="追加するシェイプの形">${SHAPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></span><button class="btn sm" data-ladd="image">＋ 画像</button></div>
      <div class="btnrow"><button class="btn sm" data-lop="up" title="手前へ">↑ 手前</button><button class="btn sm" data-lop="down" title="奥へ">↓ 奥</button><button class="btn sm" data-lop="dup">複製</button><button class="btn sm danger" data-lop="del">削除</button></div>
      <div class="note">モニター上でレイヤーをクリックして選択・ドラッグで移動、四隅で拡大縮小。何も選ばずにドラッグするとグラフィック全体が動きます。</div>
    </div></div>`;
    if (!L) return h + '<div class="sec"><div class="in note">レイヤーを選ぶと、文字・塗り・エッジ・影・テクスチャ・動きを編集できます。</div></div>';
    const lt = clamp(st.time - c.start, 0, c.dur);
    const lv = (p) => layerVal(L, p, lt);
    h += `<div class="sec"><h4><span class="sw" style="background:var(--accent)"></span>レイヤー「${escapeHtml(L.name || '')}」の位置・動き</h4><div class="in">
      ${field('位置 X', scrub('L.x', lv('x'), { step: 1, unit: 'px' }) + kfBtnL(c, L, 'x'))}
      ${field('位置 Y', scrub('L.y', lv('y'), { step: 1, unit: 'px' }) + kfBtnL(c, L, 'y'))}
      ${field('スケール', scrub('L.scale', lv('scale'), { step: 1, min: 1, max: 2000, unit: '%' }) + kfBtnL(c, L, 'scale'))}
      ${field('回転', scrub('L.rotation', lv('rotation'), { step: 1, min: -3600, max: 3600, unit: '°' }) + kfBtnL(c, L, 'rotation'))}
      ${field('不透明度', scrub('L.opacity', lv('opacity'), { step: 1, min: 0, max: 100, unit: '%' }) + kfBtnL(c, L, 'opacity'))}
      <div class="btnrow"><button class="btn sm" data-lalign="center">中央に</button><button class="btn sm" data-lalign="hcenter">左右中央</button><button class="btn sm" data-lalign="vcenter">上下中央</button></div>
    </div></div>`;
    if (L.kind === 'text') {
      const f = L.font || {};
      const weights = ((D && D.FONTS && D.FONTS[f.family] && D.FONTS[f.family].weights) || ['400', '700', '900']).map(Number);
      h += `<div class="sec"><h4>テキスト</h4><div class="in">
        <textarea id="L-text" rows="2">${escapeHtml(L.text || '')}</textarea>
        ${field('フォント', `<select id="L-family">${FONT_LIST.map((x) => `<option${x === f.family ? ' selected' : ''}>${escapeHtml(x)}</option>`).join('')}</select>`)}
        ${field('太さ', `<select id="L-weight">${Array.from(new Set(weights.concat([+f.weight || 400]))).sort((a, b) => a - b).map((w) => `<option value="${w}"${+f.weight === w ? ' selected' : ''}>${w}</option>`).join('')}</select>`)}
        ${field('サイズ', scrub('L.font.size', f.size || 100, { step: 1, min: 4, max: 1000, unit: 'px' }))}
        ${field('字間', scrub('L.font.letterSpacing', (f.letterSpacing || 0), { step: 0.01, min: -0.5, max: 2, unit: 'em', dec: 2 }))}
        ${field('行間', scrub('L.font.lineHeight', f.lineHeight || 1.2, { step: 0.02, min: 0.5, max: 4, unit: '倍', dec: 2 }))}
        ${field('揃え', `<span class="seg">${[['left', '左'], ['center', '中央'], ['right', '右']].map(([v, l]) => `<button class="btn sm${(L.align || 'center') === v ? ' primary' : ''}" data-lal="${v}">${l}</button>`).join('')}</span><label style="margin-left:8px"><input type="checkbox" id="L-italic"${f.italic ? ' checked' : ''}> 斜体</label>`)}
        <div class="btnrow"><button class="btn sm" id="L-applydesign" title="左の「テロップ」タブで選んだデザインの、フォント・塗り・縁・影をこの文字に適用">テロップのデザインを適用</button></div>
      </div></div>`;
    }
    if (L.kind === 'shape') {
      h += `<div class="sec"><h4>シェイプ</h4><div class="in">
        ${field('形', `<select id="L-shape">${SHAPES.map(([v, l]) => `<option value="${v}"${L.shape === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${field('幅', scrub('L.w', L.w || 200, { step: 2, min: 1, max: 8000, unit: 'px' }))}
        ${field('高さ', scrub('L.h', L.h || 100, { step: 2, min: 1, max: 8000, unit: 'px' }))}
        ${field('角の丸み', scrub('L.radius', L.radius || 0, { step: 1, min: 0, max: 4000, unit: 'px' }))}
        <div class="btnrow"><button class="btn sm" data-lfit="w">横幅いっぱい</button><button class="btn sm" data-lfit="all">画面いっぱい</button></div>
      </div></div>`;
    }
    if (L.kind === 'image') {
      const imgs = P.media.filter((m) => m.type === 'image');
      h += `<div class="sec"><h4>画像</h4><div class="in">
        ${field('画像', `<select id="L-img">${imgs.map((m) => `<option value="${m.id}"${L.mediaId === m.id ? ' selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>`)}
        ${field('幅', scrub('L.w', L.w || 400, { step: 2, min: 1, max: 8000, unit: 'px' }))}
      </div></div>`;
    }
    if (L.kind === 'text' || L.kind === 'shape') {
      const fl = L.fill || { on: true, paint: solidPaint('#fff') };
      h += `<div class="sec"><h4>塗り<label style="margin-left:auto;font-weight:400"><input type="checkbox" data-fillon${fl.on !== false ? ' checked' : ''}> オン</label></h4><div class="in${fl.on !== false ? '' : ' dim'}">
        ${paintEditor('種類', 'fill.paint', fl.paint)}
        ${field('不透明度', scrub('L.fill.opacity', fl.opacity == null ? 100 : fl.opacity, { step: 1, min: 0, max: 100, unit: '%' }))}
      </div></div>`;
      h += edgesEditor(L) + shadowEditor(L);
      if (L.kind === 'text') h += textureEditor(L);
      h += `<div class="sec"><div class="in">${recentRow()}</div></div>`;
    }
    return h;
  }

  function bindGraphicInspector(c) {
    const L = selectedLayer(c);
    const touch = () => { if (L) layerCache.delete(L.id); };
    const redraw = (full) => { touch(); if (full) changed({ props: true }); else { changed({ props: true, light: true }); } };
    // レイヤーパネル
    $$('[data-lsel]', insp).forEach((row) => {
      row.addEventListener('click', (e) => { if (e.target.closest('.lb')) return; st.selLayer = { clipId: c.id, layerId: row.dataset.lsel }; st.kfSel.clear(); changed({ selection: true }); });
      row.addEventListener('dblclick', () => { const x = c.layers.find((y) => y.id === row.dataset.lsel); const n = prompt('レイヤー名', x.name || ''); if (n != null) { pushUndo(); x.name = n.trim() || x.name; changed({ props: true }); } });
    });
    $$('[data-lvis]', insp).forEach((b) => b.addEventListener('click', () => { const x = c.layers.find((y) => y.id === b.dataset.lvis); pushUndo(); x.visible = x.visible === false; changed({ props: true }); }));
    $$('[data-llock]', insp).forEach((b) => b.addEventListener('click', () => { const x = c.layers.find((y) => y.id === b.dataset.llock); pushUndo(); x.locked = !x.locked; changed({ props: true }); }));
    $$('[data-ladd]', insp).forEach((b) => b.addEventListener('click', async () => {
      const kind = b.dataset.ladd;
      let nl;
      if (kind === 'text') nl = defaultTextLayer('テキスト');
      else if (kind === 'shape') nl = shapeLayerOf(($('#L-addshape', insp) || {}).value || 'round');
      else {
        let imgs = P.media.filter((m) => m.type === 'image' && media.has(m.id));
        if (!imgs.length) { toast('先に「プロジェクト」に画像を読み込んでください（ロゴ・写真など）'); $('#file-media').click(); return; }
        nl = defaultImageLayer(imgs[imgs.length - 1].id);
      }
      pushUndo();
      // 選択中のレイヤーのすぐ上に
      const idx = L ? c.layers.indexOf(L) + 1 : c.layers.length;
      c.layers.splice(idx, 0, nl);
      st.selLayer = { clipId: c.id, layerId: nl.id };
      changed({ props: true });
    }));
    $$('[data-lop]', insp).forEach((b) => b.addEventListener('click', () => {
      if (!L) return toast('レイヤーを選んでください');
      const i = c.layers.indexOf(L), op = b.dataset.lop;
      pushUndo();
      if (op === 'del') { c.layers.splice(i, 1); st.selLayer = c.layers[Math.max(0, i - 1)] ? { clipId: c.id, layerId: c.layers[Math.max(0, i - 1)].id } : null; }
      if (op === 'dup') { const d = clone(L); d.id = uid('L'); d.name = (L.name || '') + ' のコピー'; d.x = (d.x || 0) + 30; d.y = (d.y || 0) + 30; c.layers.splice(i + 1, 0, d); st.selLayer = { clipId: c.id, layerId: d.id }; }
      if (op === 'up' && i < c.layers.length - 1) { c.layers.splice(i, 1); c.layers.splice(i + 1, 0, L); }
      if (op === 'down' && i > 0) { c.layers.splice(i, 1); c.layers.splice(i - 1, 0, L); }
      changed({ props: true });
    }));
    if (!L) return;
    $$('[data-lalign]', insp).forEach((b) => b.addEventListener('click', () => {
      pushUndo();
      const gk = kfValue(c, 'scale', st.time) / 100, gx = kfValue(c, 'x', st.time), gy = kfValue(c, 'y', st.time);
      if (b.dataset.lalign !== 'vcenter') setLayerProp(c, L, 'x', Math.round(-gx / gk));
      if (b.dataset.lalign !== 'hcenter') setLayerProp(c, L, 'y', Math.round(-gy / gk));
      changed({ props: true });
    }));
    $$('[data-lkf]', insp).forEach((b) => {
      const prop = b.dataset.lkf;
      b.addEventListener('click', () => {
        pushUndo();
        const lt = clamp(st.time - c.start, 0, c.dur);
        const has = L.kf && L.kf[prop] && L.kf[prop].length;
        if (!has) { setKfObj(L, prop, lt, layerVal(L, prop, lt), c.dur); }
        else {
          const k = L.kf[prop], i = k.findIndex((x) => Math.abs(x[0] - lt) < 0.5 / fps());
          if (i >= 0) { const cur = layerVal(L, prop, lt); k.splice(i, 1); if (!k.length) { L[prop] = cur; delete L.kf[prop]; } }
          else setKfObj(L, prop, lt, layerVal(L, prop, lt), c.dur);
        }
        changed({ props: true });
      });
    });
    const ta = $('#L-text', insp);
    if (ta) {
      ta.addEventListener('input', () => { pushUndo('Ltext' + L.id); L.text = ta.value; redraw(false); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') ta.blur(); else if (!((e.ctrlKey || e.metaKey) && /^[sSmM]$/.test(e.key))) e.stopPropagation(); });
    }
    const on = (sel, ev, fn) => { const el = $(sel, insp); if (el) el.addEventListener(ev, fn); };
    on('#L-family', 'change', (e) => { pushUndo(); L.font.family = e.target.value; const ws = ((D.FONTS[L.font.family] || {}).weights || []).map(Number); if (ws.length && !ws.includes(+L.font.weight)) L.font.weight = ws[ws.length - 1]; redraw(true); });
    on('#L-weight', 'change', (e) => { pushUndo(); L.font.weight = +e.target.value; redraw(true); });
    on('#L-italic', 'change', (e) => { pushUndo(); L.font.italic = e.target.checked; redraw(false); });
    on('#L-applydesign', 'click', () => { pushUndo(); applyDesignToTextLayer(L); redraw(true); });
    on('#L-shape', 'change', (e) => { pushUndo(); L.shape = e.target.value; redraw(true); });
    on('#L-img', 'change', (e) => { pushUndo(); L.mediaId = e.target.value; redraw(true); });
    $$('[data-lal]', insp).forEach((b) => b.addEventListener('click', () => { pushUndo(); L.align = b.dataset.lal; redraw(true); }));
    $$('[data-lfit]', insp).forEach((b) => b.addEventListener('click', () => { pushUndo(); const gk = kfValue(c, 'scale', st.time) / 100; L.w = Math.round(P.width / gk); L.x = 0; if (b.dataset.lfit === 'all') { L.h = Math.round(P.height / gk); L.y = 0; L.radius = 0; } redraw(true); }));
    $$('[data-fillon]', insp).forEach((b) => b.addEventListener('change', () => { pushUndo(); L.fill = L.fill || { paint: solidPaint('#fff') }; L.fill.on = b.checked; redraw(true); }));
    $$('[data-shon]', insp).forEach((b) => b.addEventListener('change', () => { pushUndo(); L.shadow = L.shadow || {}; L.shadow.on = b.checked; if (b.checked && !L.shadow.paint) Object.assign(L.shadow, { paint: solidPaint('#000'), opacity: 55, distance: 8, angle: 135, length: 0, hardness: 70 }); redraw(true); }));
    $$('[data-txon]', insp).forEach((b) => b.addEventListener('change', () => { pushUndo(); L.texture = L.texture || { kind: 'stripes', scale: 100, opacity: 60 }; L.texture.on = b.checked; redraw(true); }));
    on('[data-txkind]', 'change', (e) => { pushUndo(); L.texture.kind = e.target.value; redraw(true); });
    on('[data-tximg]', 'change', (e) => { pushUndo(); L.texture.mediaId = e.target.value; redraw(true); });
    // エッジ
    on('[data-sadd]', 'click', () => { pushUndo(); L.strokes = L.strokes || []; const last = L.strokes[L.strokes.length - 1]; L.strokes.push({ on: true, width: last ? Math.max(4, Math.round(last.width * 0.8)) : 10, paint: solidPaint(L.strokes.length % 2 ? '#ffffff' : '#111111'), join: 'round', opacity: 100 }); redraw(true); });
    $$('[data-son]', insp).forEach((b) => b.addEventListener('change', () => { pushUndo(); L.strokes[+b.dataset.son].on = b.checked; redraw(false); }));
    $$('[data-sdel]', insp).forEach((b) => b.addEventListener('click', () => { pushUndo(); L.strokes.splice(+b.dataset.sdel, 1); redraw(true); }));
    $$('[data-smove]', insp).forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.smove, j = i + +b.dataset.dir; if (j < 0 || j >= L.strokes.length) return; pushUndo(); const [s] = L.strokes.splice(i, 1); L.strokes.splice(j, 0, s); redraw(true); }));
    $$('[data-sjoin]', insp).forEach((b) => b.addEventListener('change', () => { pushUndo(); L.strokes[+b.dataset.sjoin].join = b.value; redraw(false); }));
    // 塗りの種類（単色 ⇔ グラデーション）
    $$('[data-ptype]', insp).forEach((sel) => sel.addEventListener('change', () => {
      const path = sel.dataset.ptype, cur = getPath(L, path) || solidPaint('#fff');
      const base = cur.type === 'solid' ? (cur.color || '#ffffff') : ((cur.stops && cur.stops[0] && cur.stops[0][1]) || '#ffffff');
      pushUndo();
      if (sel.value === 'solid') setPath(L, path, solidPaint(base));
      else {
        const p = parseColor(base) || { r: 255, g: 255, b: 255 };
        const dark = toHex({ r: p.r * 0.45, g: p.g * 0.45, b: p.b * 0.45 });
        setPath(L, path, { type: sel.value, angle: cur.angle == null ? 180 : cur.angle, stops: cur.stops && cur.stops.length > 1 ? cur.stops : [[0, base], [1, dark]] });
      }
      redraw(true);
    }));
    $$('[data-gadd]', insp).forEach((b) => b.addEventListener('click', () => { const pt = getPath(L, b.dataset.gadd); pushUndo(); const last = pt.stops[pt.stops.length - 1]; pt.stops.push([1, last ? last[1] : '#fff']); pt.stops.forEach((s, i) => { s[0] = +(i / (pt.stops.length - 1)).toFixed(3); }); redraw(true); }));
    $$('[data-gdel]', insp).forEach((b) => b.addEventListener('click', () => { const pt = getPath(L, b.dataset.gdel); pushUndo(); pt.stops.splice(+b.dataset.gi, 1); redraw(true); }));
    // 色（スポイト付き）
    bindColorFields(insp, (k) => getPath(L, k), (k, v, final) => { pushUndo('Lcolor' + k + L.id); setPath(L, k, v); touch(); if (final) changed({ props: true, light: true }); else requestDraw(); });
  }
  /** レイヤーのプロパティを設定（キーフレームがある／自動キーなら、再生ヘッドの位置のキーに） */
  function setLayerProp(c, L, path, v) {
    if (KF_PROPS.includes(path) && ((L.kf && L.kf[path] && L.kf[path].length) || st.autoKey)) setKfObj(L, path, st.time - c.start, v, c.dur);
    else if (/\.stops\.\d+\.0$/.test(path)) setPath(L, path, clamp(v / 100, 0, 1));
    else setPath(L, path, v);
    layerCache.delete(L.id);
  }

  /* =================================================================
     変更通知
     ================================================================= */
  function changed(what) {
    what = what || {};
    if (what.structure || what.selection) { renderTimeline(); renderInspector(); }
    else if (what.props) { if (!what.light) renderInspector(); renderTimeline(); }
    if (what.structure) { renderBin(); if (st.ltab === 'tx' && !(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.captext)) renderCaptions(); }
    if (!st.playing) syncMedia(st.time, false);
    requestDraw();
    drawKfStrip();
    if (what.structure || what.props) scheduleSave();
    $('#projname').value = P.name;
    const mt = $('[data-mtab="insp"]'); if (mt) mt.classList.toggle('dot', st.sel.size > 0);
  }

  /* =================================================================
     無音カット
     ================================================================= */
  async function silenceDialog() {
    let targets = withPartners(P.clips.filter((c) => st.sel.has(c.id))).filter(hasSound);
    if (!targets.length) {
      const cands = P.clips.filter(hasSound);
      const v1 = cands.filter((c) => c.track === 'V1' || partners(c).some((x) => x.track === 'V1'));
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
    // リンクされた映像も同じ位置で切る（詰める処理は音声側で1回だけ）
    const inRes = new Set(result.map((r) => r.c));
    for (const r of result.slice()) for (const p of partners(r.c)) {
      if (inRes.has(p) || Math.abs(p.start - r.c.start) > EPS || Math.abs(p.dur - r.c.dur) > EPS || Math.abs((p.in || 0) - (r.c.in || 0)) > EPS) continue;
      inRes.add(p); result.push({ c: p, keeps: r.keeps, follower: true });
    }
    // 後ろのクリップから処理すると時刻計算がずれない
    result.sort((a, b) => b.c.start - a.c.start || (a.follower ? 1 : 0) - (b.follower ? 1 : 0));
    let totalRemoved = 0;
    const newSel = [];
    for (const { c, keeps, follower } of result) {
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
        if (c.link) n.link = c.link + '_' + idx;
        n.start = snapFrame(pos); n.in = (c.in || 0) + a; n.dur = snapFrame(b - a);
        n.fadeIn = idx === 0 ? c.fadeIn : 0; n.fadeOut = idx === keeps.length - 1 ? c.fadeOut : 0;
        pos += n.dur; parts.push(n);
      });
      const removed = c.dur - parts.reduce((s, x) => s + x.dur, 0);
      if (!follower) totalRemoved += removed;
      P.clips = P.clips.filter((x) => x.id !== c.id);
      if (ripple && !follower) {
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
      ${field('置き場所', `<select id="srt-tr">${P.tracks.filter((t) => t.kind === 'video' && t.id !== 'V1').map((t) => `<option value="${t.id}"${!srtDefault && !P.clips.some((c) => c.track === t.id) ? (srtDefault = ' selected') : ''}>${t.id}${P.clips.some((c) => c.track === t.id) ? '（使用中）' : '（空き）'}</option>`).join('')}<option value="new"${srtDefault ? '' : ' selected'}>新しい映像トラック</option></select>`)}
    `, [['キャンセル', null], ['読み込む', 'go', true]]);
    const r = await m.result;
    if (r !== 'go') return;
    const off = $('#srt-at', m.el).value === 'ph' ? st.time : 0;
    let tid = $('#srt-tr', m.el).value;
    pushUndo();
    if (tid === 'new') tid = addTrack('video', true).id;
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
    const esc = (e) => { if (e.key === 'Escape' && !(opts && opts.locked)) { e.stopPropagation(); close(null); } if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && buttons && buttons.length) { const pri = buttons.findIndex((b) => b[2]); if (pri >= 0 && !(opts && opts.locked)) { e.preventDefault(); const v = buttons[pri][1]; if (typeof v === 'function') v(); else close(v); } } };
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
    const items = P.clips.filter((c) => hasSound(c) && !(trackById(c.track) || {}).muted && media.has(c.mediaId));
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
        // fastSeek：全フレームがキーフレームの素材（自動書き出しのプロキシ）なら seeked 直後に描ける
        if (el.requestVideoFrameCallback && !window.__ccFastSeek) { let ok = false; el.requestVideoFrameCallback(() => { ok = true; fin(); }); setTimeout(() => { if (!ok) fin(); }, 60); }
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
    const missing = P.clips.filter((c) => !['telop', 'shape', 'graphic'].includes(c.type) && !media.has(c.mediaId));
    if (missing.length && !confirm(`${missing.length} 個のクリップの素材が見つかりません（未リンク）。このまま書き出しますか？`)) return;
    const lockedUsed = P.clips.filter((c) => c.type === 'telop' && isLocked(c.designId));
    if (lockedUsed.length) {
      const names = Array.from(new Set(lockedUsed.map((c) => (designById.get(c.designId) || {}).name))).slice(0, 5);
      const q = openModal('製品版のテロップが含まれています', `
        <p>次のデザインは製品版専用です：<b>${names.map(escapeHtml).join('、')}</b>${lockedUsed.length > 5 ? ' など' : ''}（${lockedUsed.length} 個）</p>
        <p>解除コードを入力すると透かしなしで書き出せます。このまま書き出すと「SAMPLE」の透かしが入ります。</p>
      `, [['キャンセル', null], ['透かし付きで書き出す', 'wm'], ['解除コードを入力', 'unlock', true]]);
      const a = await q.result;
      if (!a) return;
      if (a === 'unlock' && !(await unlockDialog())) return;
    }
    const hasWC = !!(window.VideoEncoder && window.VideoFrame && window.Mp4Muxer);
    const name = (P.name || 'chain-cut').replace(/[\\/:*?"<>|]/g, '_');
    const m = openModal('MP4 に書き出し', `
      ${hasWC ? '' : '<p style="color:var(--warn)">このブラウザは高速書き出し（WebCodecs）に対応していません。Chrome または Edge の最新版でお使いください。</p>'}
      ${field('ファイル名', `<input type="text" id="x-name" value="${escapeHtml(name)}">`)}
      ${field('解像度', `<select id="x-res"><option value="1">${P.width}×${P.height}（フル）</option><option value="0.6667">${Math.round(P.width * 2 / 3 / 2) * 2}×${Math.round(P.height * 2 / 3 / 2) * 2}（軽量）</option><option value="0.5">${P.width / 2}×${P.height / 2}（確認用）</option></select>`)}
      ${field('画質', '<select id="x-q"><option value="20">高画質（20 Mbps）</option><option value="12" selected>標準（12 Mbps）</option><option value="6">軽量（6 Mbps）</option></select>')}
      ${field('範囲', `<select id="x-range">${inOut() ? `<option value="io" selected>イン〜アウト（${tc(inOut()[1] - inOut()[0])}）</option>` : ''}<option value="all">全体（${tc(total)}）</option>${P.clips.some((c) => st.sel.has(c.id)) ? '<option value="sel">選択したクリップの範囲</option>' : ''}</select>`)}
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
    if (opts.range === 'io' && inOut()) { [t0, t1] = inOut(); }
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
      await ensureGraphicFonts();

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
    P = normalizeProject(Object.assign(newProject(o.aspect, o.fps), o));
    registerProjectDesigns();
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
    addShape: () => addShape('round'),
    addText: () => { const c = addGraphic([defaultTextLayer('テキスト')], 'テキスト'); setTimeout(() => { const ta = $('#L-text'); if (ta) { ta.focus(); ta.select(); } }, 30); return c; },
    addGraphicFromDesign: () => {
      if (!st.libDesign) return toast('左の「テロップ」タブでデザインを選んでください');
      const d = designById.get(st.libDesign);
      const layers = layersFromTelop(st.libDesign, st.libVariant, d.sample, d.sampleSub || '', null, 100);
      if (layers) addGraphic(layers, d.name);
    },
    easyEase: () => easyEase('both'), easeIn: () => easyEase('in'), easeOut: () => easyEase('out'), easeCurve: () => easeEditor(),
    toggleKfPanel: () => $('#kf-toggle').click(), autoKey: () => $('#kf-auto').click(),
    voice: () => toggleVoice(),
    addTelop: () => {
      const sel = P.clips.find((c) => st.sel.has(c.id) && c.type === 'telop');
      pushUndo();
      let start = st.time;
      let tr = sel ? trackById(sel.track) : null;
      if (tr) {
        // 選択中テロップのトラックの再生ヘッド位置にテロップがあれば、その後ろへ
        const over = P.clips.find((c) => c.track === tr.id && isActive(c, start));
        if (over) start = clipEnd(over);
        if (!trackFree(tr.id, start, 3)) tr = null;
      }
      if (!tr) tr = freeVideoTrack(start, 3);
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
    addTrackVideo: () => addTrack('video'), addTrackTelop: () => addTrack('video'), addTrackAudio: () => addTrack('audio'),
    linkToggle: () => toggleLink(),
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
    shortcuts: shortcutsDialog,
    unlock: unlockDialog,
    shuttleBack: () => shuttle(-1), shuttleStop: () => shuttle(0), shuttleFwd: () => shuttle(1),
    stepBack5: () => { pause(); seek(snapFrame(st.time - 5 / fps())); followPlayhead(); },
    stepFwd5: () => { pause(); seek(snapFrame(st.time + 5 / fps())); followPlayhead(); },
    markIn: () => setMark('in', st.time), markOut: () => setMark('out', st.time), markClip,
    clearInOut: () => { pushUndo('mark'); P.inPoint = null; P.outPoint = null; drawInOut(); drawRuler(); scheduleSave(); },
    goIn: () => { if (P.inPoint != null) { pause(); seek(P.inPoint); followPlayhead(); } },
    goOut: () => { if (P.outPoint != null) { pause(); seek(P.outPoint); followPlayhead(); } },
    lift: () => liftOrExtract(false), extract: () => liftOrExtract(true),
    rippleTrimPrev: () => rippleTrim(-1), rippleTrimNext: () => rippleTrim(1),
    splitAll,
    toolSelect: () => setTool('select'), toolRazor: () => setTool('razor'), toolRipple: () => setTool('ripple'),
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

  /* ---------- スマホ：下のタブで「素材・テロップ・効果音・文字起こし・調整」をシートで開く ---------- */
  function isMobile() { return window.matchMedia('(max-width: 820px)').matches; }
  function closeSheets() {
    $('#panel-left').classList.remove('sheet-open'); $('#panel-right').classList.remove('sheet-open');
    $$('[data-mtab]').forEach((b) => b.classList.remove('on'));
  }
  function openSheet(tab) {
    const L = $('#panel-left'), R = $('#panel-right');
    const was = tab === 'insp' ? R.classList.contains('sheet-open') : (L.classList.contains('sheet-open') && st.ltab === tab);
    closeSheets();
    if (was) return;
    if (tab === 'insp') R.classList.add('sheet-open');
    else { const b = $(`[data-ltab="${tab}"]`); if (b) b.click(); L.classList.add('sheet-open'); }
    const mb = $(`[data-mtab="${tab}"]`); if (mb) mb.classList.add('on');
  }
  $$('[data-mtab]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.mtab)));
  $$('[data-closesheet]').forEach((b) => b.addEventListener('click', closeSheets));
  // シートの中で「追加」系を押したら、結果が見えるようにシートを閉じる
  $('#panel-left').addEventListener('click', (e) => {
    if (!isMobile()) return;
    const b = e.target.closest('[data-cmd="addTelop"],[data-cmd="addGraphicFromDesign"],[data-cmd="applyDesign"],[data-libpreset]');
    if (b) setTimeout(closeSheets, 60);
  });
  // ピンチでタイムラインの拡大縮小
  let pinch = null;
  const pinchDist = (e) => Math.max(20, Math.abs(e.touches[0].clientX - e.touches[1].clientX));
  scroller.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) pinch = { d: pinchDist(e), pps: st.pps, t: timeAtX((e.touches[0].clientX + e.touches[1].clientX) / 2) };
  }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    setZoom(pinch.pps * pinchDist(e) / pinch.d, pinch.t);
  }, { passive: false });
  scroller.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });

  $$('[data-ltab]').forEach((b) => b.addEventListener('click', () => {
    st.ltab = b.dataset.ltab;
    $$('[data-ltab]').forEach((x) => x.classList.toggle('on', x === b));
    for (const k of ['bin', 'lib', 'se', 'tx']) $('#tab-' + k).classList.toggle('hidden', st.ltab !== k);
    if (st.ltab === 'tx') renderCaptions();
    if (st.ltab === 'lib') renderLibPresets();
    $('#btn-import').classList.toggle('hidden', st.ltab !== 'bin');
    if (st.ltab === 'lib' && !libGrid.children.length) renderLib();
    if (st.ltab === 'se') renderSe();
  }));

  $('#file-media').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  $('#file-srt').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importSrtFile(f); e.target.value = ''; });
  $('#file-proj').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openProjectFile(f); e.target.value = ''; });
  $('#projname').addEventListener('change', (e) => { pushUndo(); P.name = e.target.value.trim() || '無題のプロジェクト'; scheduleSave(); document.title = `${P.name} — Chain Cut`; });
  $('#projname').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });

  /* =================================================================
     キーボードショートカット（変更可能）
     ================================================================= */
  const ACTIONS = [
    // [id, 表示名, 分類, 既定キー]
    ['togglePlay', '再生／停止', '再生', ['Space']],
    ['shuttleBack', '逆再生（連打で倍速）', '再生', ['J']],
    ['shuttleStop', '停止', '再生', ['K']],
    ['shuttleFwd', '再生（連打で倍速）', '再生', ['L']],
    ['stepBack', '1フレーム戻る', '再生', ['ArrowLeft']],
    ['stepFwd', '1フレーム進む', '再生', ['ArrowRight']],
    ['stepBack5', '5フレーム戻る', '再生', ['Shift+ArrowLeft']],
    ['stepFwd5', '5フレーム進む', '再生', ['Shift+ArrowRight']],
    ['prevEdit', '前の編集点へ', '再生', ['ArrowUp']],
    ['nextEdit', '次の編集点へ', '再生', ['ArrowDown']],
    ['goStart', '先頭へ', '再生', ['Home']],
    ['goEnd', '末尾へ', '再生', ['End']],
    ['markIn', 'イン点をマーク', 'イン／アウト', ['I']],
    ['markOut', 'アウト点をマーク', 'イン／アウト', ['O']],
    ['markClip', 'クリップの範囲をマーク', 'イン／アウト', ['X']],
    ['clearInOut', 'イン／アウトを消去', 'イン／アウト', ['Ctrl+Shift+X']],
    ['goIn', 'イン点へ移動', 'イン／アウト', ['Shift+I']],
    ['goOut', 'アウト点へ移動', 'イン／アウト', ['Shift+O']],
    ['lift', 'リフト（範囲を削除・すき間を残す）', 'イン／アウト', [';']],
    ['extract', '抽出（範囲を削除して詰める）', 'イン／アウト', ["'"]],
    ['rippleTrimPrev', '前の編集点から再生ヘッドまで削除して詰める', 'カット', ['Q']],
    ['rippleTrimNext', '再生ヘッドから次の編集点まで削除して詰める', 'カット', ['W']],
    ['split', '再生ヘッドで分割', 'カット', ['Ctrl+K']],
    ['splitAll', '全トラックを再生ヘッドで分割', 'カット', ['Ctrl+Shift+K']],
    ['delete', '削除', 'カット', ['Delete', 'Backspace']],
    ['rippleDelete', 'リップル削除', 'カット', ['Shift+Delete', 'Shift+Backspace']],
    ['silence', '無音部分を自動カット', 'カット', ['Ctrl+Alt+X']],
    ['toolSelect', '選択ツール', 'ツール', ['V']],
    ['toolRazor', 'レーザーツール', 'ツール', ['C']],
    ['toolRipple', 'リップルツール', 'ツール', ['B']],
    ['toggleSnap', 'スナップ切替', 'ツール', ['S']],
    ['addTelop', 'テロップを追加', '編集', ['T']],
    ['addShape', 'シェイプを追加', '編集', ['Shift+T']],
    ['addText', 'テキスト（レイヤー）を追加', '編集', ['Alt+T']],
    ['linkToggle', '映像と音声のリンク／解除（分ける）', '編集', ['Ctrl+L']],
    ['easyEase', 'イージーイーズ（選んだキーフレーム）', 'キーフレーム', ['F9']],
    ['easeIn', 'イーズイン（入りをゆっくり）', 'キーフレーム', ['Shift+F9']],
    ['easeOut', 'イーズアウト（出をゆっくり）', 'キーフレーム', ['Ctrl+Shift+F9']],
    ['easeCurve', 'イージングのカーブ調整', 'キーフレーム', ['Ctrl+F9']],
    ['toggleKfPanel', 'キーフレームパネルの表示', 'キーフレーム', ['Shift+K']],
    ['autoKey', '自動キー（動かすとキーフレーム）', 'キーフレーム', ['Alt+K']],
    ['voice', '音声で編集（マイク オン／オフ）', '編集', ['Ctrl+Shift+V']],
    ['undo', '取り消し', '編集', ['Ctrl+Z']],
    ['redo', 'やり直し', '編集', ['Ctrl+Shift+Z', 'Ctrl+Y']],
    ['copy', 'コピー', '編集', ['Ctrl+C']],
    ['paste', '再生ヘッドに貼り付け', '編集', ['Ctrl+V']],
    ['duplicate', '複製', '編集', ['Ctrl+D']],
    ['selectAll', 'すべて選択', '編集', ['Ctrl+A']],
    ['deselect', '選択解除', '編集', ['Escape']],
    ['zoomIn', 'タイムライン拡大', '表示', ['=', '+']],
    ['zoomOut', 'タイムライン縮小', '表示', ['-']],
    ['zoomFit', '全体を表示', '表示', ['\\']],
    ['toggleSafe', 'セーフエリアガイド', '表示', ['G']],
    ['new', '新規プロジェクト', 'ファイル', ['Ctrl+Alt+N']],
    ['open', 'プロジェクトを開く', 'ファイル', ['Ctrl+O']],
    ['save', 'プロジェクトを保存', 'ファイル', ['Ctrl+S']],
    ['savePackage', '素材ごとパッケージ保存', 'ファイル', ['Ctrl+Shift+S']],
    ['import', '素材を読み込み', 'ファイル', ['Ctrl+I']],
    ['export', 'MP4 に書き出し', 'ファイル', ['Ctrl+M']],
    ['shortcuts', 'ショートカット一覧・変更', 'ヘルプ', ['?', 'Shift+?']],
  ];
  const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a[0], a]));
  const KEYS_LS = 'cc-keys';
  let keyOverrides = {};
  try { keyOverrides = JSON.parse(localStorage.getItem(KEYS_LS) || '{}') || {}; } catch (e) { keyOverrides = {}; }
  function keysFor(id) { return keyOverrides[id] || (ACTION_BY_ID.get(id) || [])[3] || []; }
  let keyIndex = new Map();
  function rebuildKeyIndex() {
    keyIndex = new Map();
    for (const [id] of ACTIONS) for (const k of keysFor(id)) keyIndex.set(k, id);
    // メニューの表示も更新
    $$('.dd button[data-cmd]').forEach((b) => {
      const k = keysFor(b.dataset.cmd)[0];
      let span = b.querySelector('.k');
      if (!k) { if (span) span.textContent = ''; return; }
      if (!span) { span = document.createElement('span'); span.className = 'k'; b.appendChild(span); }
      span.textContent = keyLabel(k);
    });
  }
  /** 物理キー（e.code）→ 英数字のキー名（US 配列基準） */
  const CODE_SYM = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlYen: '\\', IntlRo: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: 'Space' };
  function codeKey(code) {
    if (!code) return null;
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return code.slice(6);
    return CODE_SYM[code] || null;
  }
  /** キーイベント → "Ctrl+Shift+K" 形式 */
  function comboOf(e) {
    let k = e.key;
    if (k === ' ' || k === 'Spacebar') k = 'Space';
    if (k === 'Esc') k = 'Escape';
    if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'KanaMode', 'HiraganaKatakana', 'Hankaku', 'Zenkaku', 'Romaji', 'Convert', 'NonConvert'].includes(k)) return null;
    // 日本語入力（かな入力・ローマ字入力・全角英数）のときも、押したキーの場所で判定する
    if (k.length === 1 && /[^\x20-\x7e]/.test(k)) { const n = k.normalize('NFKC'); k = /^[\x21-\x7e]$/.test(n) ? n : (codeKey(e.code) || k); }
    if (k === 'Process' || k === 'Unidentified' || k === 'Dead') { k = codeKey(e.code); if (!k) return null; }
    if (k.length === 1) k = k.toUpperCase();
    // Alt で文字が変わる配列（Mac）対策：英字・数字は物理キーから
    if (e.altKey && e.code && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    if (e.altKey && e.code && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    // 記号は Shift で別の文字になるので、英字・特殊キー以外は Shift を含めない
    if (e.shiftKey && (/^[A-Z0-9]$/.test(k) || k.length > 1)) parts.push('Shift');
    parts.push(k);
    return parts.join('+');
  }
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  function keyLabel(c) {
    const map = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Backspace: 'BS', Delete: 'Del' };
    return c.split('+').map((p) => (p === 'Ctrl' ? (IS_MAC ? '⌘' : 'Ctrl') : p === 'Alt' && IS_MAC ? '⌥' : map[p] || p)).join(IS_MAC ? '' : '+');
  }
  function keysHtml(id) { return keysFor(id).map((c) => `<kbd>${escapeHtml(keyLabel(c))}</kbd>`).join(' '); }

  function shortcutsDialog() {
    let editing = null;
    const groups = [];
    for (const a of ACTIONS) { let g = groups.find((x) => x.name === a[2]); if (!g) groups.push(g = { name: a[2], items: [] }); g.items.push(a); }
    const body = () => `<p class="note" style="font-size:11px;color:var(--muted)">「変更」を押してから新しいキーを押すと割り当てられます（Esc で取り消し、Delete で割り当てなし）。設定はこのブラウザに保存されます。</p>
      <div style="max-height:56vh;overflow:auto;display:flex;flex-direction:column;gap:2px">
      ${groups.map((g) => `<div style="font-weight:700;color:var(--ink2);margin:8px 0 2px">${g.name}</div>` + g.items.map(([id, label]) => `
        <div class="field" style="min-height:28px"><label style="width:auto;flex:1">${label}</label>
          <div class="ctl" style="flex:none;gap:6px">${editing === id ? '<span style="color:var(--warn)">キーを押してください…</span>' : `<span>${keysHtml(id) || '<span class="unit">なし</span>'}</span>`}
            <button class="btn sm" data-kedit="${id}">${editing === id ? 'やめる' : '変更'}</button></div></div>`).join('')).join('')}
      </div>`;
    const m = openModal('キーボードショートカット', body(), [['初期値に戻す', () => { if (confirm('すべてのショートカットを初期値に戻しますか？')) { keyOverrides = {}; persist(); refresh(); } }], ['閉じる', null, true]], { width: 620 });
    const persist = () => { try { localStorage.setItem(KEYS_LS, JSON.stringify(keyOverrides)); } catch (e) { /* ignore */ } rebuildKeyIndex(); };
    const refresh = () => { $('.mb', m.el).innerHTML = body(); };
    $('.mb', m.el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-kedit]'); if (!b) return;
      editing = editing === b.dataset.kedit ? null : b.dataset.kedit; refresh();
    });
    const onKey = (e) => {
      if (!editing) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { editing = null; refresh(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { keyOverrides[editing] = []; editing = null; persist(); refresh(); return; }
      const c = comboOf(e); if (!c) return;
      const other = keyIndex.get(c);
      if (other && other !== editing) {
        const oa = ACTION_BY_ID.get(other);
        if (!confirm(`${keyLabel(c)} は「${oa[1]}」に使われています。こちらに付け替えますか？`)) return;
        keyOverrides[other] = keysFor(other).filter((x) => x !== c);
      }
      keyOverrides[editing] = [c];
      editing = null; persist(); refresh();
    };
    document.addEventListener('keydown', onKey, true);
    m.result.then(() => document.removeEventListener('keydown', onKey, true));
  }

  /* キーボード */
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if ($('.modal-bg')) return;
    if (e.isComposing && (tag === 'input' || tag === 'textarea')) return; // 文字入力の変換中
    const combo = comboOf(e);
    if (!combo) return;
    const id = keyIndex.get(combo);
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
      // 入力中でも効くもの：保存・書き出し、Esc で入力欄から抜ける
      if (id === 'save' || id === 'savePackage' || id === 'export') { e.preventDefault(); cmd[id](); }
      else if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (!id || !cmd[id]) return;
    e.preventDefault();
    cmd[id]();
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
    await checkStoredLicense();
    setupLib();
    rebuildKeyIndex();
    updateLicenseBadge();
    $('#btn-voice').addEventListener('click', () => toggleVoice());
    try {
      const saved = await idbGet('kv', 'project');
      if (saved && Array.isArray(saved.clips)) {
        P = normalizeProject(Object.assign(newProject(saved.aspect, saved.fps), saved));
        for (const mm of P.media) if (mm.type === 'image') mm.duration = Infinity;
        await restoreMedia();
      }
    } catch (e) { console.warn('restore failed', e); }
    registerProjectDesigns();
    renderLibPresets();
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
    get layerRects() { return layerRects; }, get lastRects() { return lastRects; },
    voiceCommand, addShape, addGraphic, placeMedia, toggleLink, applyMotion, startMotionRec, stopMotionRec, normalizeProject, openSheet, closeSheets, defaultTextLayer, defaultShapeLayer, layersFromTelop, convertTelopToGraphic, easyEase, kfAt, bezierFn, setKfObj,
    get selLayer() { return st.selLayer; }, set selLayer(v) { st.selLayer = v; }, colorSlots, parseColor, comboOf,
    transcribe, captionsToTelops, addCaptionRow, splitLongRows, get presets() { return presets; }, applyPresetById,
    importFiles, cmd, seek, drawFrame, openProjectFile, unlockWithCode, registerProjectDesigns, kfValue, animated,
    isLocked: (id) => isLocked(id), detectKeeps, applySilenceCut, parseSrt, runExport, getBuffer,
    select: (ids) => { st.sel = new Set(ids); changed({ selection: true }); },
  };

  boot();
})();
