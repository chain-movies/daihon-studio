import numpy as np, os, math
from PIL import Image, ImageFilter
FPS=24; W,H=1920,1080
os.makedirs('glow_frames', exist_ok=True)
# --- glyph mask from the final (static) frame, cleaned ---
last = np.asarray(Image.open('src_frames/0111.png').convert('RGB')).astype(np.float32)
r,g,b = last[...,0],last[...,1],last[...,2]
mx=last.max(-1); mn=last.min(-1); sat=(mx-mn)/np.maximum(mx,1)
gold=(r>g)&(g>b)&(sat>0.35)&(mx<235)&(mx>90)&((r-b)>70)
gold[:, :int(W*0.49)] = False
m = Image.fromarray((gold*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.5))
M = np.asarray(m).astype(np.float32)/255.0
m.save('glyph_mask_clean.png')
ys,xs=np.where(M>0.5); bx0,bx1,by0,by1=xs.min(),xs.max(),ys.min(),ys.max()
print('bbox',bx0,by0,bx1,by1)
def blur(arr, rad):
    return np.asarray(Image.fromarray((np.clip(arr,0,1)*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad))).astype(np.float32)/255.0
G1 = blur(M, 28); G1 /= max(G1.max(),1e-6)          # tight glow
G2 = blur(M, 110); G2 /= max(G2.max(),1e-6)         # wide halo
glow_rgb = np.array([255,186,84],np.float32)/255
inner_rgb = np.array([255,232,170],np.float32)/255
spec_rgb = np.array([255,250,235],np.float32)/255
# diagonal coordinate for the sweep
yy,xx = np.mgrid[0:H,0:W].astype(np.float32)
diag = xx + 0.6*(yy-by0)   # slanted band
d0, d1 = bx0-250, bx1+250
def smooth(x): x=np.clip(x,0,1); return x*x*(3-2*x)
def screen(a,b): return 1-(1-a)*(1-b)
T_START, T_RAMP = 2.85, 0.5
for i in range(1,112):
    t=(i-1)/FPS
    fr=np.asarray(Image.open(f'src_frames/{i:04d}.png').convert('RGB')).astype(np.float32)/255
    if t < T_START:
        Image.fromarray((fr*255).astype(np.uint8)).save(f'glow_frames/{i:04d}.png'); continue
    ramp = smooth((t-T_START)/T_RAMP)
    breathe = 1.0 + 0.10*math.sin(2*math.pi*(t-T_START-T_RAMP)/2.6 - math.pi/2) if t>T_START+T_RAMP else 1.0
    k = ramp*breathe
    # bloom burst at the moment of "lighting up" (extra pop that fades)
    pop = 0.30*smooth((t-T_START)/0.35)*(1-smooth((t-T_START-0.35)/0.6))
    out = fr.copy()
    halo = (G1*0.38 + G2*0.20) * (k*0.62 + pop)
    out = screen(out, halo[...,None]*glow_rgb)
    out = screen(out, (M*(0.07*k + 0.14*pop))[...,None]*inner_rgb)
    # specular sweep across the glyph
    ts0, ts1 = 3.05, 3.95
    if ts0 <= t <= ts1+0.1:
        p = (t-ts0)/(ts1-ts0); c = d0 + p*(d1-d0)
        band = np.exp(-((diag-c)/95.0)**2)
        out = screen(out, (M*band*0.42)[...,None]*spec_rgb)
    Image.fromarray((np.clip(out,0,1)*255+0.5).astype(np.uint8)).save(f'glow_frames/{i:04d}.png')
print('done')
