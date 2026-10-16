/* Chain Cut 文字起こしワーカー（Whisper / transformers.js）
 * 画面を固めないよう別スレッドで動かす。モデルは初回だけダウンロードされ、ブラウザにキャッシュされる。
 * 受け取る: { type:'run', id, audio: Float32Array(16kHz mono), model, lang, device }
 * 返す:     { type:'progress', ... } / { type:'result', id, chunks:[{text, timestamp:[s,e]}] } / { type:'error', id, message }
 */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';

env.allowLocalModels = false;
let asr = null, current = '';

async function load(model, device) {
  if (asr && current === model + device) return asr;
  const opts = {
    device,
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p) => self.postMessage({ type: 'progress', stage: 'load', file: p.file, status: p.status, loaded: p.loaded, total: p.total, progress: p.progress }),
  };
  try {
    asr = await pipeline('automatic-speech-recognition', model, opts);
  } catch (e) {
    if (device !== 'wasm') { // WebGPU が使えないときは CPU に切り替える
      self.postMessage({ type: 'progress', stage: 'fallback' });
      opts.device = 'wasm'; opts.dtype = 'q8'; device = 'wasm';
      asr = await pipeline('automatic-speech-recognition', model, opts);
    } else throw e;
  }
  current = model + device;
  self.postMessage({ type: 'progress', stage: 'ready', device });
  return asr;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type !== 'run') return;
  const opts = { language: m.lang || 'japanese', task: 'transcribe', return_timestamps: true, chunk_length_s: 30 };
  try {
    let out;
    try {
      out = await (await load(m.model, m.device || 'wasm'))(m.audio, opts);
    } catch (e1) {
      if ((m.device || 'wasm') === 'wasm') throw e1;
      // GPU で失敗したら CPU でやり直す
      self.postMessage({ type: 'progress', stage: 'fallback' });
      asr = null; current = '';
      out = await (await load(m.model, 'wasm'))(m.audio, opts);
    }
    self.postMessage({ type: 'result', id: m.id, chunks: out.chunks || [{ text: out.text, timestamp: [0, m.audio.length / 16000] }] });
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
