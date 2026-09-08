import numpy as np, os, math, shutil
from PIL import Image, ImageFilter
FPS=24; TOTAL=120; PEAK=90           # hold the metallic-gold frame at 3.71s, 5.0s total
SRC='mm_frames'; OUT='metal_frames'; os.makedirs(OUT, exist_ok=True)
H,W=1080,1920
peak_img = Image.open(f'{SRC}/{PEAK:04d}.png').convert('RGB')
peak = np.asarray(peak_img).astype(np.float32)/255
# glyph mask from the metallic frame: gold hue OR bright highlight inside the glyph region, closed morphologically
r,g,b = peak[...,0]*255,peak[...,1]*255,peak[...,2]*255
mx=peak.max(-1)*255; mn=peak.min(-1)*255; sat=(mx-mn)/np.maximum(mx,1)
gold=(r>g)&(g>b)&(sat>0.25)&((r-b)>45)&(mx>110)
gold[:, :int(W*0.47)] = False
m = Image.fromarray((gold*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.MinFilter(13)).filter(ImageFilter.GaussianBlur(1.5))
M = np.asarray(m).astype(np.float32)/255; m.save('glyph_mask_metal.png')
def blur(arr, rad):
    return np.asarray(Image.fromarray((np.clip(arr,0,1)*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad))).astype(np.float32)/255
G1 = blur(M, 30); G1 /= G1.max()
G2 = blur(M, 110); G2 /= G2.max()
halo_rgb = np.array([255,200,110],np.float32)/255
spec_rgb = np.array([255,248,225],np.float32)/255
def screen(a,b): return 1-(1-a)*(1-b)
def smooth(x): x=np.clip(x,0,1); return x*x*(3-2*x)
ys,xs=np.where(M>0.5); bx0,bx1,by0,by1=xs.min(),xs.max(),ys.min(),ys.max()
print('bbox',bx0,by0,bx1,by1)
yy,xx=np.mgrid[0:H,0:W].astype(np.float32); diag = xx + 0.6*(yy-by0)
d0,d1 = bx0-300, bx1+300
T0=(PEAK-1)/FPS; T1=5.0
for i in range(1, TOTAL+1):
    t=(i-1)/FPS
    if i <= PEAK:
        shutil.copy(f'{SRC}/{i:04d}.png', f'{OUT}/{i:04d}.png'); continue
    p = smooth((t-T0)/(T1-T0))
    out = peak.copy()
    # soft warm halo grows around the metallic glyph and stays at the end
    halo = (G1*0.40 + G2*0.26) * p
    out = screen(out, halo[...,None]*halo_rgb)
    # one slow glint travels across the metal surface (3.71s -> 4.85s)
    ps = np.clip((t-T0)/1.14, 0, 1)
    if ps < 1:
        c = d0 + ps*(d1-d0)
        band = np.exp(-((diag-c)/170.0)**2)
        out = screen(out, (M*band*0.32)[...,None]*spec_rgb)
    Image.fromarray((np.clip(out,0,1)*255+0.5).astype(np.uint8)).save(f'{OUT}/{i:04d}.png')
print('ok')
