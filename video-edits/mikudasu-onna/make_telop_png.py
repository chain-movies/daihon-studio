# -*- coding: utf-8 -*-
"""telop.ass と同じ体裁の透過PNGを書き出す（Premiere の V2 に overwriteClip する用）"""
import json, os, re
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1080, 1920
POS_Y = 1375
FONT_PATH = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
STROKE = 8
OUT = "telop_png"
os.makedirs(OUT, exist_ok=True)

def parse_ass(path):
    items = []
    for line in open(path, encoding="utf-8"):
        m = re.match(r"Dialogue: 0,([\d:.]+),([\d:.]+),Telop,,0,0,0,,\{(.*?)\}(.*)", line.strip())
        if not m: continue
        def sec(t):
            h, mn, s = t.split(":"); return int(h)*3600 + int(mn)*60 + float(s)
        tags, text = m.group(3), m.group(4)
        fs = re.search(r"\\fscx(\d+)", tags)
        items.append({"start": sec(m.group(1)), "end": sec(m.group(2)),
                      "text": text, "scale": int(fs.group(1)) if fs else 100})
    return items

items = parse_ass("telop.ass")
manifest = []
for i, it in enumerate(items, 1):
    size = max(1, round(100 * it["scale"] / 100))
    font = ImageFont.truetype(FONT_PATH, size, index=0)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    stroke = max(4, round(STROKE * it["scale"] / 100))
    # 薄い影（帯なしでも背景から浮かせる）
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((W//2, POS_Y + 6), it["text"], font=font, fill=(0, 0, 0, 150),
                            anchor="mm", stroke_width=stroke, stroke_fill=(0, 0, 0, 150))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(6)))
    d.text((W//2, POS_Y), it["text"], font=font, fill=(255, 255, 255, 255),
           anchor="mm", stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
    name = f"telop_{i:03d}.png"
    img.save(os.path.join(OUT, name))
    manifest.append({"file": name, "text": it["text"], "start": round(it["start"], 3),
                     "end": round(it["end"], 3), "font_px": size,
                     "pos": [W//2, POS_Y], "timeline": "edited"})
json.dump({"resolution": [W, H], "font": "Noto Sans CJK JP Bold",
           "note": "start/end は編集後タイムライン（cutlist.json の render_timeline）基準の秒",
           "items": manifest}, open("telop_manifest.json", "w"), ensure_ascii=False, indent=1)
print(f"{len(manifest)} PNG generated")
