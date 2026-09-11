"""Stabilised assembly: every generated clip frame is warped (scale + per-frame vertical drift) onto the geometry of
the locked head plate, uncovered borders are filled from the plate, colours are matched with one constant affine.
Reuses retimed frames in asm_<SRC>/A/r*.png and asm_<SRC>/B/r*.png."""
import sys, os, glob, shutil, subprocess, numpy as np, imageio_ffmpeg
from PIL import Image
ff=imageio_ffmpeg.get_ffmpeg_exe()
name=sys.argv[1]; src=sys.argv[2]
HEAD=48; TOTAL=120; W,H=1920,1080
A=sorted(glob.glob(f'asm_{src}/A/r*.png')); B=sorted(glob.glob(f'asm_{src}/B/r*.png')); mid=A+B
L=lambda p: np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
G=lambda a: a.mean(2)
plate=L(f'stretch_frames/{HEAD:04d}.png'); pg=G(plate)
def pc(a,b):
    A_=np.fft.fft2(a-a.mean()); B_=np.fft.fft2(b-b.mean()); R=A_*np.conj(B_); R/=np.abs(R)+1e-6
    r=np.fft.ifft2(R).real; iy,ix=np.unravel_index(np.argmax(r),r.shape)
    if iy>a.shape[0]//2: iy-=a.shape[0]
    if ix>a.shape[1]//2: ix-=a.shape[1]
    return float(iy),float(ix)
regions={'left_mtn':(slice(150,750),slice(0,700)),'right_mtn':(slice(100,700),slice(700,1400)),'far_right':(slice(100,700),slice(1400,1920)),'lake_left':(slice(750,1080),slice(0,900)),'lake_mid':(slice(750,1080),slice(900,1500))}
first=G(L(A[0]))
pts=[]
for k,(ry,rx) in regions.items():
    dy,dx=pc(pg[ry,rx], first[ry,rx]); cy=(ry.start+ry.stop)/2; cx=(rx.start+rx.stop)/2; pts.append((cx,cy,dx,dy))
pts=np.array(pts)
# fit dx = (sx-1)*x + tx ; dy = (sy-1)*y + ty  (least squares)
Ax=np.c_[pts[:,0],np.ones(len(pts))]; sx_1,tx=np.linalg.lstsq(Ax,pts[:,2],rcond=None)[0]
Ay=np.c_[pts[:,1],np.ones(len(pts))]; sy_1,ty=np.linalg.lstsq(Ay,pts[:,3],rcond=None)[0]
print('region displacements (cx,cy,dx,dy):', pts.round(1).tolist())
print(f'fit: sx={1+sx_1:.4f} tx={tx:.1f}  sy={1+sy_1:.4f} ty={ty:.1f}')
# per-frame vertical drift of each clip measured in the glyph-free left band, relative to the clip's own first frame
band=(slice(150,750),slice(0,700))
def drift(frames, ref):
    d=[pc(ref[band], G(L(p))[band])[0] for p in frames]
    d=np.array(d); k=np.ones(5)/5; dp=np.convolve(np.pad(d,(2,2),mode='edge'),k,mode='valid'); return dp
dA=drift(A, first); lastA=G(L(A[-1])); dB=drift(B, G(L(B[0])))+dA[-1]   # B continues from A's end geometry
drifts=np.concatenate([dA,dB]); print('vertical drift (A then B):', drifts.round(1).tolist())
def warp(fr, sign, dyt):
    # output(x,y) = clip(sx*x+tx, sy*y+ty+dyt) with sign choosing the displacement convention
    a=1+sign*sx_1; c=sign*tx; e=1+sign*sy_1; f=sign*(ty+dyt)
    im=Image.fromarray(np.clip(fr+0.5,0,255).astype(np.uint8))
    out=np.asarray(im.transform((W,H), Image.AFFINE, (a,0,c,0,e,f), resample=Image.BICUBIC)).astype(np.float32)
    # validity mask (input coords inside the frame)
    xs=np.arange(W)[None,:]; ys=np.arange(H)[:,None]
    inx=a*xs+c; iny=e*ys+f
    valid=((inx>=0)&(inx<=W-1)&(iny>=0)&(iny<=H-1)).astype(np.float32)[...,None]
    return out*valid + plate*(1-valid)
# choose the displacement sign convention by residual alignment of the first frame
best=None
for sign in (+1,-1):
    w=G(warp(L(A[0]), sign, drifts[0]))
    res=sum(abs(v) for k,(ry,rx) in regions.items() for v in pc(pg[ry,rx], w[ry,rx]))
    print('sign',sign,'residual',res)
    if best is None or res<best[0]: best=(res,sign)
sign=best[1]; ty+=float(os.environ.get('DY_ADJ','0'))
# constant colour match: warped first frame -> plate (whole frame statistics)
w0=warp(L(A[0]),sign,drifts[0]); hm=plate.reshape(-1,3).mean(0); hs=plate.reshape(-1,3).std(0); cm=w0.reshape(-1,3).mean(0); cs=w0.reshape(-1,3).std(0)
gain=hs/np.maximum(cs,1e-3); off=hm-cm*gain; print('colour gain',gain.round(3),'off',off.round(1))
seq=f'asm_{name}/seq'; shutil.rmtree(f'asm_{name}',ignore_errors=True); os.makedirs(seq)
for i in range(1,HEAD+1): shutil.copy(f'stretch_frames/{i:04d}.png', f'{seq}/{i:04d}.png')
for k,p in enumerate(mid):
    fr=L(p)*gain+off
    out=warp(fr, sign, drifts[k])
    Image.fromarray(np.clip(out+0.5,0,255).astype(np.uint8)).save(f'{seq}/{HEAD+k+1:04d}.png')
subprocess.run([ff,'-y','-v','error','-framerate','24','-i',f'{seq}/%04d.png','-an','-vf','format=yuv420p','-c:v','libx264','-preset','slow','-crf','17','-profile:v','high','-level','4.1','-movflags','+faststart','-r','24',f'out/{name}_video.mp4'],check=True)
subprocess.run([ff,'-y','-v','error','-i',f'out/{name}_video.mp4','-i','audio/mix_5s.wav','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',f'out/{name}_audio.mp4'],check=True)
# verification: residual shift of the mountain vs plate for every 6th frame, in glyph-free regions
print('VERIFY residual (left_mtn, lake_left) vs plate:')
for i in range(HEAD+1,TOTAL+1,6):
    g=G(L(f'{seq}/{i:04d}.png')); print(i, pc(pg[regions['left_mtn']], g[regions['left_mtn']]), pc(pg[regions['lake_left']], g[regions['lake_left']]))
print('done')
