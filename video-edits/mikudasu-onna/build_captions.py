# -*- coding: utf-8 -*-
"""校正済みスクリプト -> テロップ単位(caption)に分割し、編集後タイムラインへ写像して ASS を出力"""
import json, re, sys
import budoux
from PIL import ImageFont

MAX_CHARS = 12          # 絶対上限
FILL_CHARS = 12         # ユーザー確定: 1画面最大12文字
MAX_W     = 970          # ユーザー確定: 11〜12文字はこの幅に収まるよう自動縮小          # テロップの最大幅(px)
FONT_SIZE = 100          # 実ピクセルの em サイズ（幅計算用）
# libass は CJK フォントの hhea メトリクスで文字を縮めるため、ASS 上のフォントサイズは
# 実測校正値 1.48 倍を指定して実 100px に合わせる（100 指定だと実 67px になる）
ASS_FONT_SIZE = 148
FONT_PATH = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
POS_Y     = 1367         # libass の an5 は行ボックス基準で約8px下にずれるため補正（実測中心 1375）
PNG_POS_Y = 1375         # 1080x1920 での縦中心（顔に被らず、下25%のUI帯も避ける）
PLAY_W, PLAY_H = 1080, 1920

parser = budoux.load_default_japanese_parser()
font   = ImageFont.truetype(FONT_PATH, FONT_SIZE, index=0)

def text_width(s):
    return font.getlength(s)

def split_units(text):
    """句読点で必ず切り、文節境界で MAX_CHARS 以内に詰める。表示テキストからは句読点を除去。"""
    # 句読点の直後で強制分割（句読点は分割片の末尾に残したまま渡す）
    parts, buf = [], ""
    for ch in text:
        buf += ch
        if ch in "、。":
            parts.append(buf); buf = ""
    if buf: parts.append(buf)

    # 2文字以下の断片（え、／あ、／さ、等）は単独画面にせず次の断片へ吸収する
    # 「え、」「あ、」等 2文字以下の断片は単独画面にすると点滅するので次の断片に連結し、
    # 読点は読みの間として残したまま、あらためて文節分割し直す
    i = 0
    while i < len(parts) - 1:
        if len(parts[i].rstrip("、。")) <= 2:
            parts[i+1] = parts[i] + parts[i+1]
            parts.pop(i); continue
        i += 1
    if len(parts) > 1 and len(parts[-1].rstrip("、。")) <= 2:
        parts[-2] = parts[-2].rstrip("、。") + parts[-1]; parts.pop()

    units = []
    for part in parts:
        core = part.rstrip("、。")
        if not core: continue
        chunks = parser.parse(core) or [core]
        cur = ""
        for c in chunks:
            cand = cur + c
            if cur and (len(cand) > FILL_CHARS):
                units.append(cur); cur = c
            else:
                cur = cand
            # 単一文節が MAX_CHARS を超える場合はやむなく機械分割
            while len(cur) > MAX_CHARS:
                units.append(cur[:MAX_CHARS]); cur = cur[MAX_CHARS:]
        if cur: units.append(cur)
    return merge_orphans(units)

ORPHAN = set("さねよのがをにでとへもかなわ")
# 隣に吸収できずに単独画面として残ってしまうフィラーは除去する（shorts のフィラー除去に準拠）
FILLER = {"え", "あ", "えー", "あー", "あの", "まあ", "その", "うーん", "えっ", "あっ", "んー"}

def merge_orphans(units):
    """1〜2文字の助詞・終助詞だけの画面は前後に吸収する（点滅・読みにくさ防止）"""
    i = 1
    while i < len(units):
        u = units[i]
        if len(u) <= 2 and all(ch in ORPHAN for ch in u):
            if len(units[i-1]) + len(u) <= MAX_CHARS:
                units[i-1] += u; units.pop(i); continue
            if i + 1 < len(units) and len(u) + len(units[i+1]) <= MAX_CHARS:
                units[i+1] = u + units[i+1]; units.pop(i); continue
        i += 1
    # 隣に収まらず単独で残ったフィラー画面は落とす（0.3秒の点滅を作らない）
    units = [u for i, u in enumerate(units)
             if not (len(units) > 1 and u.rstrip("、。") in FILLER)]
    # 先頭が孤立助詞なら次に吸収
    if len(units) > 1 and len(units[0]) <= 2 and all(ch in ORPHAN for ch in units[0]) \
       and len(units[0]) + len(units[1]) <= MAX_CHARS:
        units[1] = units[0] + units[1]; units.pop(0)
    return units

MIN_DUR = 0.55   # 1画面の最短表示時間(s)。下回る画面は隣とマージする

def enforce_min_duration(units, dur):
    """文字数按分で MIN_DUR を下回る画面が出ないよう、短い画面を隣に吸収する"""
    changed = True
    while changed and len(units) > 1:
        changed = False
        total = sum(len(u) for u in units)
        for i, u in enumerate(units):
            if dur * len(u) / total >= MIN_DUR:
                continue
            # 短い方の隣（結合後 MAX_CHARS 以内）に寄せる
            cands = []
            if i + 1 < len(units) and len(u) + len(units[i+1]) <= MAX_CHARS:
                cands.append((len(units[i+1]), i, i + 1))
            if i - 1 >= 0 and len(u) + len(units[i-1]) <= MAX_CHARS:
                cands.append((len(units[i-1]), i - 1, i))
            if not cands:
                continue
            _, a, b = min(cands)
            units[a] = units[a] + units[b]
            units.pop(b)
            changed = True
            break
    return units

def build():
    lines = json.load(open("script.json"))["lines"]
    caps = []
    for ln in lines:
        units = split_units(ln["t"])
        if not units: continue
        s, e = ln["s"], ln["e"]
        units = enforce_min_duration(units, e - s)
        total = sum(len(u) for u in units)
        t = s
        for u in units:
            d = (e - s) * len(u) / total
            caps.append({"text": u, "s": round(t, 3), "e": round(t + d, 3)})
            t += d
    # 「間」の扱い: 次まで1秒未満なら表示維持 / 1秒以上なら発話終了+0.3sで消す
    for i, c in enumerate(caps):
        nxt = caps[i+1]["s"] if i+1 < len(caps) else None
        if nxt is None:
            c["e"] = min(c["e"] + 0.3, 145.02)
        elif nxt - c["e"] < 1.0:
            c["e"] = nxt              # 表示維持（点滅させない）
        else:
            c["e"] = c["e"] + 0.3
        c["e"] = round(min(c["e"], nxt if nxt else 145.02), 3)
    return caps

# ---- 編集後タイムラインへの写像 ----
def load_keeps():
    return json.load(open("cutlist.json"))["keep_segments"]

def map_time(t, keeps):
    """元素材の時刻 t -> 編集後の時刻。カット区間内なら None"""
    off = 0.0
    for k in keeps:
        if t < k["start"]:
            return None
        if t <= k["end"]:
            return off + (t - k["start"])
        off += k["end"] - k["start"]
    return None

def clamp_into(t, keeps, forward):
    """カット区間に落ちた時刻を、近い側の keep 境界へ寄せる"""
    for k in keeps:
        if k["start"] <= t <= k["end"]:
            return t
    if forward:
        for k in keeps:
            if t < k["start"]: return k["start"]
        return keeps[-1]["end"]
    for k in reversed(keeps):
        if t > k["end"]: return k["end"]
    return keeps[0]["start"]

def ts(sec):
    if sec < 0: sec = 0
    h = int(sec // 3600); m = int(sec % 3600 // 60); s = sec % 60
    return f"{h}:{m:02d}:{s:05.2f}"

HEADER = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {PLAY_W}
PlayResY: {PLAY_H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Telop,Noto Sans CJK JP,{ASS_FONT_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,1,8,4,5,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

def main():
    caps = build()
    keeps = load_keeps()
    out, kept, dropped = [], 0, 0
    prev_end = -1.0
    for c in caps:
        s_src = clamp_into(c["s"], keeps, True)
        e_src = clamp_into(c["e"], keeps, False)
        s = map_time(s_src, keeps); e = map_time(e_src, keeps)
        if s is None or e is None or e - s < 0.15:
            dropped += 1; continue
        if s < prev_end: s = prev_end          # 重なり禁止
        if e - s < 0.15: dropped += 1; continue
        prev_end = e
        w = text_width(c["text"])
        scale = 100 if w <= MAX_W else max(60, int(MAX_W / w * 100))
        tag = f"\\an5\\pos({PLAY_W//2},{POS_Y})"
        if scale != 100: tag += f"\\fscx{scale}\\fscy{scale}"
        out.append(f"Dialogue: 0,{ts(s)},{ts(e)},Telop,,0,0,0,,{{{tag}}}{c['text']}")
        kept += 1
    open("telop.ass", "w", encoding="utf-8").write(HEADER + "\n".join(out) + "\n")
    json.dump(caps, open("captions_src.json", "w"), ensure_ascii=False, indent=1)
    print(f"captions: {kept} 表示 / {dropped} 破棄(カット区間)")
    over = [c for c in caps if text_width(c["text"]) > MAX_W]
    print(f"12文字幅超過で自動縮小: {len(over)} 件")
    for c in over[:10]: print("   ", c["text"], int(text_width(c["text"])), "px")

if __name__ == "__main__":
    main()
