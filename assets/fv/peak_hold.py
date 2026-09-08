import numpy as np, os, math, shutil
from PIL import Image, ImageFilter
FPS=24; TOTAL=111; PEAK=64
os.makedirs('peak_frames', exist_ok=True)
M = np.asarray(Image.open('glyph_mask_clean.png')).astype(np.float32)/255
def blur(arr, rad):
    return np.asarray(Image.fromarray((np.clip(arr,0,1)*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad))).astype(np.float32)/255
G = blur(M, 40); G /= G.max()
glow_rgb = np.array([255,200,110],np.float32)/255
def screen(a,b): return 1-(1-a)*(1-b)
peak = np.asarray(Image.open(f'src_frames/{PEAK:04d}.png').convert('RGB')).astype(np.float32)/255
for i in range(1, TOTAL+1):
    if i <= PEAK:
        shutil.copy(f'src_frames/{i:04d}.png', f'peak_frames/{i:04d}.png'); continue
    # hold the peak frame; add a very gentle breathing halo so it stays alive (0 at the peak, max +5%)
    t = (i-PEAK)/FPS
    k = 0.05*(0.5-0.5*math.cos(2*math.pi*t/2.4))
    out = screen(peak, (G*k)[...,None]*glow_rgb)
    Image.fromarray((np.clip(out,0,1)*255+0.5).astype(np.uint8)).save(f'peak_frames/{i:04d}.png')
print('ok')
