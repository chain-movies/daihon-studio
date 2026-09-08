import numpy as np, os, math, shutil
from PIL import Image, ImageFilter
FPS=24; TOTAL=120; PEAK=64          # 5.0s total, peak-glow frame at 2.62s
T0, T1 = 3.0, 5.0                   # window where the light gradually changes
os.makedirs('evolve_frames', exist_ok=True)
M = np.asarray(Image.open('glyph_mask_clean.png')).astype(np.float32)/255
def blur(arr, rad):
    return np.asarray(Image.fromarray((np.clip(arr,0,1)*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad))).astype(np.float32)/255
G1 = blur(M, 30); G1 /= G1.max()
G2 = blur(M, 110); G2 /= G2.max()
halo_rgb = np.array([255,196,100],np.float32)/255
spec_rgb = np.array([255,250,235],np.float32)/255
warm_tint = np.array([1.0,0.93,0.80],np.float32)
def screen(a,b): return 1-(1-a)*(1-b)
def smooth(x): x=np.clip(x,0,1); return x*x*(3-2*x)
H,W=1080,1920
ys,xs=np.where(M>0.5); bx0,bx1,by0,by1=xs.min(),xs.max(),ys.min(),ys.max()
yy,xx=np.mgrid[0:H,0:W].astype(np.float32); diag = xx + 0.6*(yy-by0)
d0,d1 = bx0-300, bx1+300
peak = np.asarray(Image.open(f'src_frames/{PEAK:04d}.png').convert('RGB')).astype(np.float32)/255
for i in range(1, TOTAL+1):
    t=(i-1)/FPS
    if i <= PEAK:
        shutil.copy(f'src_frames/{i:04d}.png', f'evolve_frames/{i:04d}.png'); continue
    out = peak.copy()
    if t >= T0:
        p = smooth((t-T0)/(T1-T0))                # 0 -> 1 over 3.0-5.0s (ease in/out)
        # 1) glyph slowly shifts from white-hot to a warmer gold light
        tint = 1.0 + (warm_tint-1.0)*(0.85*p)
        out = out*(1-M[...,None]) + (out*tint)*M[...,None]
        # 2) warm halo grows around the glyph and stays at full at the end
        halo = (G1*0.62 + G2*0.42) * p
        out = screen(out, halo[...,None]*halo_rgb)
        # 3) one slow specular sweep travels across the glyph (3.0s -> 4.7s)
        ps = np.clip((t-T0)/1.7, 0, 1)
        if ps < 1:
            c = d0 + ps*(d1-d0)
            band = np.exp(-((diag-c)/190.0)**2)
            out = screen(out, (M*band*0.6)[...,None]*spec_rgb)
    Image.fromarray((np.clip(out,0,1)*255+0.5).astype(np.uint8)).save(f'evolve_frames/{i:04d}.png')
print('ok')
