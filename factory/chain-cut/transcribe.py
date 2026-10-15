#!/usr/bin/env python3
"""音声を文字起こしして、単語ごとの時刻つき JSON を出す（faster-whisper）。

  pip install faster-whisper
  python3 factory/chain-cut/transcribe.py 素材.mp4 --out work/words.json [--model small] [--lang ja]

出力: {"language": "ja", "duration": 秒, "segments": [{"start","end","text","words":[{"start","end","word","p"}]}]}
初回はモデル（small で約 500MB）をダウンロードする。精度を上げたいときは --model medium。
"""
import argparse
import json
import os
import subprocess
import sys


def load_audio(path, sr=16000):
    """ffmpeg で 16kHz モノラルの float 配列にする（PyAV の版ずれを避けるため）"""
    import numpy as np
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('media')
    ap.add_argument('--out', required=True)
    ap.add_argument('--model', default=os.environ.get('CHAIN_CUT_WHISPER', 'small'))
    ap.add_argument('--lang', default='ja')
    ap.add_argument('--prompt', default='', help='固有名詞などのヒント（例：出演者名、商品名）')
    a = ap.parse_args()
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit('faster-whisper がありません: pip install faster-whisper')
    model = WhisperModel(a.model, device='auto', compute_type='int8')
    segs, info = model.transcribe(
        load_audio(a.media), language=a.lang, word_timestamps=True, vad_filter=True,
        initial_prompt=a.prompt or None, beam_size=5,
    )
    out = {'language': info.language, 'duration': info.duration, 'model': a.model, 'segments': []}
    for s in segs:
        words = [{'start': round(w.start, 3), 'end': round(w.end, 3), 'word': w.word, 'p': round(w.probability, 3)} for w in (s.words or [])]
        out['segments'].append({'start': round(s.start, 3), 'end': round(s.end, 3), 'text': s.text.strip(), 'words': words})
        print(f'[{s.start:7.2f} → {s.end:7.2f}] {s.text.strip()}', flush=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'→ {a.out}（{len(out["segments"])} 区間）')


if __name__ == '__main__':
    main()
