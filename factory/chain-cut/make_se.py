#!/usr/bin/env python3
"""Chain Cut 用の効果音（SE）を合成して apps/chain-cut/se/ に書き出す。

すべて数式から作る自作音源なので、著作権・ライセンスの心配なく商用利用できる。
  python3 factory/chain-cut/make_se.py
"""
import json
import os
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'chain-cut', 'se')
rng = np.random.default_rng(7)


def t_(d):
    return np.arange(int(SR * d)) / SR


def env(n, a=0.005, r=None, curve=4.0):
    """アタック a 秒 + 指数減衰"""
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4))
    d = n / SR
    return e * np.exp(-curve * t / (r or d))


def sweep(f0, f1, d, shape='sine'):
    t = t_(d)
    f = f0 * (f1 / f0) ** (t / d)
    ph = 2 * np.pi * np.cumsum(f) / SR
    if shape == 'square':
        return np.sign(np.sin(ph))
    if shape == 'saw':
        return 2 * ((ph / (2 * np.pi)) % 1) - 1
    if shape == 'tri':
        return 2 * np.abs(2 * ((ph / (2 * np.pi)) % 1) - 1) - 1
    return np.sin(ph)


def tone(f, d, shape='sine'):
    return sweep(f, f, d, shape)


def noise(d):
    return rng.uniform(-1, 1, int(SR * d))


def lowpass(x, cutoff):
    """1次 IIR（cutoff は定数か配列）"""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out


def at(x, sec):
    return np.concatenate([np.zeros(int(SR * sec)), x])


def fade_tail(x, d=0.01):
    n = int(SR * d)
    if n and len(x) > n:
        x[-n:] *= np.linspace(1, 0, n)
    return x


# ---------------- 音づくり ----------------
def se_pop():
    d = 0.14
    return sweep(900, 320, d) * env(int(SR * d), 0.002, curve=6)


def se_pon():
    d = 0.35
    x = mix(tone(1046, d) * 0.7, tone(2092, d) * 0.2) * env(int(SR * d), 0.002, curve=7)
    return x


def se_whoosh():
    d = 0.55
    n = int(SR * d)
    t = np.arange(n) / SR
    shape = np.sin(np.pi * t / d) ** 2
    cut = 400 + 5000 * shape
    return highpass(lowpass(noise(d), cut), 150) * shape * 2.5


def se_swipe():
    d = 0.22
    n = int(SR * d)
    t = np.arange(n) / SR
    shape = np.sin(np.pi * (t / d) ** 0.6) ** 2
    return highpass(lowpass(noise(d), 2500 + 6000 * t / d), 600) * shape * 2.8


def se_don():
    d = 0.9
    body = sweep(110, 45, d) * env(int(SR * d), 0.002, curve=5)
    click = lowpass(noise(0.03), 3000) * env(int(SR * 0.03), 0.001, curve=8) * 0.8
    return mix(body, click)


def se_dodon():
    return mix(se_don() * 0.9, at(se_don(), 0.18))


def se_kira():
    notes = [1568, 2093, 2637, 3136, 4186]
    parts = []
    for i, f in enumerate(notes):
        d = 0.6
        x = mix(tone(f, d), tone(f * 2.01, d) * 0.3) * env(int(SR * d), 0.002, curve=6) * 0.5
        parts.append(at(x, i * 0.05))
    return mix(*parts)


def se_pikon():
    a = tone(1318, 0.08, 'square') * 0.35
    b = tone(1975, 0.16, 'square') * 0.35 * env(int(SR * 0.16), 0.001, curve=4)
    return lowpass(mix(a, at(b, 0.08)), 6000)


def se_seikai():
    a = mix(tone(1318, 0.25), tone(2636, 0.25) * 0.2) * env(int(SR * 0.25), 0.003, curve=3)
    b = mix(tone(1046, 0.6), tone(2092, 0.6) * 0.2) * env(int(SR * 0.6), 0.003, curve=4)
    return mix(a * 0.6, at(b * 0.6, 0.22))


def se_buzzer():
    d = 0.7
    x = mix(tone(130, d, 'square'), tone(138, d, 'square')) * 0.25
    e = np.ones(int(SR * d)); e[-int(SR * 0.05):] = np.linspace(1, 0, int(SR * 0.05))
    return lowpass(x * e, 2500)


def se_chin():
    d = 2.0
    partials = [(1, 1.0), (2.76, 0.5), (5.4, 0.25), (8.93, 0.12)]
    x = mix(*[tone(880 * k, d) * a for k, a in partials])
    return x * env(int(SR * d), 0.001, curve=4) * 0.5


def se_jan():
    d = 1.2
    chord = [261.6, 329.6, 392.0, 523.3]
    x = mix(*[lowpass(tone(f, d, 'saw'), 3000) * 0.3 for f in chord])
    hit = se_don()[: int(SR * d)] * 0.6
    return mix(x * env(int(SR * d), 0.004, curve=3), hit)


def se_boing():
    d = 0.7
    t = t_(d)
    f = 180 * (1 + 0.8 * np.exp(-6 * t)) * (1 + 0.12 * np.sin(2 * np.pi * 14 * t) * np.exp(-3 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(int(SR * d), 0.004, curve=3)


def se_shutter():
    a = highpass(noise(0.04), 1500) * env(int(SR * 0.04), 0.0005, curve=6)
    b = highpass(noise(0.06), 1000) * env(int(SR * 0.06), 0.0005, curve=5)
    return mix(a, at(b * 0.8, 0.09))


def se_type():
    parts = []
    for i in range(10):
        click = highpass(noise(0.025), 2000) * env(int(SR * 0.025), 0.0003, curve=10) * rng.uniform(0.5, 1)
        parts.append(at(click, i * 0.075 + rng.uniform(-0.01, 0.01) + 0.01))
    return mix(*parts)


def se_drumroll():
    d = 1.6
    parts = []
    k = 0.0
    while k < d:
        hit = lowpass(noise(0.05), 2500) * env(int(SR * 0.05), 0.001, curve=7)
        parts.append(at(hit * (0.4 + 0.6 * k / d), k))
        k += 0.045
    end = mix(se_don() * 0.7, lowpass(noise(0.4), 5000) * env(int(SR * 0.4), 0.001, curve=4) * 0.5)
    parts.append(at(end, d))
    return mix(*parts)


def se_zun():
    d = 1.6
    x = mix(sweep(80, 38, d) * 0.9, lowpass(noise(d), 300) * 0.5) * env(int(SR * d), 0.01, curve=3)
    return x


def se_clap():
    parts = []
    for i in range(70):
        c = lowpass(highpass(noise(0.03), 700), 5000) * env(int(SR * 0.03), 0.001, curve=7)
        parts.append(at(c * rng.uniform(0.3, 1), rng.uniform(0, 1.8)))
    x = mix(*parts)
    n = len(x); x *= np.minimum(1, np.linspace(0, 6, n)) * np.minimum(1, np.linspace(4, 0, n))
    return x


def se_hyun():
    d = 0.45
    return sweep(300, 2200, d, 'tri') * env(int(SR * d), 0.01, curve=2) * 0.5


def se_byun():
    d = 0.4
    return sweep(2400, 200, d, 'tri') * env(int(SR * d), 0.005, curve=2) * 0.5


SES = [
    ('pop', 'ポン（軽い出現）', '出現・強調', se_pop),
    ('pon', 'ポーン（テロップ）', '出現・強調', se_pon),
    ('pikon', 'ピコン（ひらめき）', '出現・強調', se_pikon),
    ('kira', 'キラーン', '出現・強調', se_kira),
    ('whoosh', 'シュッ（場面転換）', 'トランジション', se_whoosh),
    ('swipe', 'スッ（スワイプ）', 'トランジション', se_swipe),
    ('hyun', 'ヒューン（上がる）', 'トランジション', se_hyun),
    ('byun', 'ビューン（下がる）', 'トランジション', se_byun),
    ('don', 'ドン（衝撃）', 'インパクト', se_don),
    ('dodon', 'ドドン', 'インパクト', se_dodon),
    ('jan', 'ジャーン', 'インパクト', se_jan),
    ('zun', 'ズーン（重い・落ち込み）', 'インパクト', se_zun),
    ('seikai', 'ピンポン（正解）', 'リアクション', se_seikai),
    ('buzzer', 'ブブー（不正解）', 'リアクション', se_buzzer),
    ('chin', 'チーン', 'リアクション', se_chin),
    ('boing', 'ボヨーン（ツッコミ・笑い）', 'リアクション', se_boing),
    ('clap', '拍手', 'リアクション', se_clap),
    ('drumroll', 'ドラムロール', '演出', se_drumroll),
    ('shutter', 'カシャ（シャッター）', '演出', se_shutter),
    ('type', 'カタカタ（タイピング）', '演出', se_type),
]


def write_wav(path, x):
    x = np.asarray(x, dtype=float)
    peak = np.max(np.abs(x)) or 1
    x = fade_tail(x / peak * 0.89)  # -1 dBFS
    data = (x * 32767).astype('<i2').tobytes()
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data)
    return len(x) / SR


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for key, name, cat, fn in SES:
        dur = write_wav(os.path.join(OUT, key + '.wav'), fn())
        index.append({'file': key + '.wav', 'id': key, 'name': name, 'cat': cat, 'dur': round(dur, 2)})
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, 'LICENSE.txt'), 'w', encoding='utf-8') as f:
        f.write('これらの効果音は factory/chain-cut/make_se.py で数式から合成した Chain-Movies のオリジナル音源です。\n'
                'Chain Cut で作った動画では、商用・非商用を問わず自由に使えます。\n')
    print(f'{len(index)} SE -> {os.path.normpath(OUT)}')


if __name__ == '__main__':
    main()
