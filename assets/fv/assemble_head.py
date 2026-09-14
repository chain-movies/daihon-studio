"""Whole-video assembly in the geometry of clip A's first frame (refA.png):
  head  : generated dawn clip (predawn -> refA), retimed to 48 frames with the sunrise instant mapped to a target frame,
          each frame stabilised (scale+shift fit + per-frame vertical drift) onto refA, borders filled from a plate,
          colour matched so that its last frame == refA statistics.
  middle: clip A (from t=0) and clip B, retimed, stabilised onto refA (drift only), then concatenated.
usage: python3 assemble_head.py NAME head.mp4 [sun_frame_target=45]"""
import sys, os, glob, shutil, subprocess, numpy as np, imageio_ffmpeg
from PIL import Image
ff=imageio_ffmpeg.get_ffmpeg_exe()
name=sys.argv[1]; head_src=sys.argv[2]; SUN_T=int(sys.argv[3]) if len(sys.argv)>3 else 45
HEAD=48; TOTAL=120; W,H=1920,1080
work=f'asm_{name}'; CACHE=os.environ.get('CACHE'); os.makedirs(work, exist_ok=True)
if CACHE:
    for d in ['H','Hr','A','Ar','B','Br']:
        if not os.path.isdir(f'{work}/{d}') and os.path.isdir(f'asm_{CACHE}/{d}'): shutil.copytree(f'asm_{CACHE}/{d}', f'{work}/{d}')
L=lambda p: np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
G=lambda a: a.mean(2)
ref=L('refA.png'); rg=G(ref)
def pc(a,b):
    A_=np.fft.fft2(a-a.mean()); B_=np.fft.fft2(b-b.mean()); R=A_*np.conj(B_); R/=np.abs(R)+1e-6
    r=np.fft.ifft2(R).real; iy,ix=np.unravel_index(np.argmax(r),r.shape)
    if iy>a.shape[0]//2: iy-=a.shape[0]
    if ix>a.shape[1]//2: ix-=a.shape[1]
    return float(iy),float(ix)
regions={'left_mtn':(slice(150,750),slice(0,700)),'right_mtn':(slice(100,700),slice(700,1400)),'far_right':(slice(100,700),slice(1400,1920)),'lake_left':(slice(750,1080),slice(0,900)),'lake_mid':(slice(750,1080),slice(900,1500))}
band=(slice(150,750),slice(0,700))
def extract(src, d, t0=0.0, t1=None):
    if os.path.isdir(d) and glob.glob(f'{d}/s*.png'): return sorted(glob.glob(f'{d}/s*.png'))
    os.makedirs(d, exist_ok=True); trim=f'trim=start={t0}'+(f':end={t1}' if t1 else '')+',setpts=PTS-STARTPTS,'
    subprocess.run([ff,'-y','-v','error','-i',src,'-vf',trim+'scale=1920:1080:flags=lanczos',f'{d}/s%04d.png'],check=True)
    return sorted(glob.glob(f'{d}/s*.png'))
def retime_map(frames, mapping, d):
    """mapping: list of source frame indices (float) for each output frame; uses motion-interpolated intermediate stream"""
    n=len(frames); os.makedirs(d, exist_ok=True)
    # build a 10x oversampled interpolated stream once (cached), then pick nearest samples
    if not glob.glob(f'{d}/i*.png'): subprocess.run([ff,'-y','-v','error','-framerate','24','-i',os.path.dirname(frames[0])+'/s%04d.png','-vf','minterpolate=fps=240:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1',f'{d}/i%05d.png'],check=True)
    inter=sorted(glob.glob(f'{d}/i*.png')); out=[]
    for k,src_idx in enumerate(mapping):
        j=int(round(src_idx*10)); j=max(0,min(len(inter)-1,j)); out.append(inter[j])
    return out
def fit_affine(img):
    pts=[]
    for k,(ry,rx) in regions.items():
        dy,dx=pc(rg[ry,rx], img[ry,rx]); pts.append(((rx.start+rx.stop)/2,(ry.start+ry.stop)/2,dx,dy))
    pts=np.array(pts)
    sx_1,tx=np.linalg.lstsq(np.c_[pts[:,0],np.ones(len(pts))],pts[:,2],rcond=None)[0]
    sy_1,ty=np.linalg.lstsq(np.c_[pts[:,1],np.ones(len(pts))],pts[:,3],rcond=None)[0]
    return sx_1,tx,sy_1,ty
def warp(fr, prm, dyt, plate=None, sign=-1, P=64):
    """affine warp; samples outside the frame are taken from an edge-replicated padding of the SAME frame,
    so the uncovered strips continue the frame's own sky/lake instead of showing a different plate."""
    sx_1,tx,sy_1,ty=prm; a=1+sign*sx_1; c=sign*tx; e=1+sign*sy_1; f=sign*(ty+dyt)
    pad=np.pad(fr, ((P,P),(P,P),(0,0)), mode='edge')
    im=Image.fromarray(np.clip(pad+0.5,0,255).astype(np.uint8))
    out=np.asarray(im.transform((W,H), Image.AFFINE, (a,0,c+P,0,e,f+P), resample=Image.BICUBIC)).astype(np.float32)
    return out
def smooth(d,k=5):
    d=np.array(d); return np.convolve(np.pad(d,(k//2,k//2),mode='edge'),np.ones(k)/k,mode='valid')
# ---------------- HEAD ----------------
hs=extract(head_src, f'{work}/H'); nh=len(hs)
# sunrise instant in the source head: first frame whose sun-region brightness exceeds a threshold
last=L(hs[-1]); gl=G(last); sy,sx=np.unravel_index(np.argmax(gl[100:700,0:1000]),gl[100:700,0:1000].shape); sy+=100
sunbox=(slice(max(0,sy-25),sy+25),slice(max(0,sx-25),sx+25))
bright=[float(G(L(p))[sunbox].mean()) for p in hs]
thr=bright[0]+0.5*(bright[-1]-bright[0]); sun_src=next(i for i,b in enumerate(bright) if b>=thr)
print(f'head src frames {nh}; sun at src frame {sun_src} ({sun_src/24:.2f}s), sun box @({sx},{sy}); target out frame {SUN_T}')
# piecewise-linear mapping: out 0..SUN_T-1 -> src 0..sun_src ; out SUN_T..47 -> src sun_src..nh-1
m1=np.linspace(0,sun_src,SUN_T,endpoint=False); m2=np.linspace(sun_src,nh-1,HEAD-SUN_T)
mapping=np.concatenate([m1,m2]); head_frames=retime_map(hs, mapping, f'{work}/Hr')
# stabilise head onto refA: fit affine on the LAST head frame (closest to refA), drift per frame vs last head frame
hl=G(L(head_frames[-1])); prm=fit_affine(hl); print('head affine fit (sx-1,tx,sy-1,ty):', np.round(prm,4))
drift=smooth([pc(hl[band], G(L(p))[band])[0] for p in head_frames])
# colour: match the warped last head frame to refA (constant affine over the head)
wl=warp(L(head_frames[-1]),prm,drift[-1]); hm=ref.reshape(-1,3).mean(0); hsd=ref.reshape(-1,3).std(0); cm=wl.reshape(-1,3).mean(0); cs=wl.reshape(-1,3).std(0)
gain=hsd/np.maximum(cs,1e-3); off=hm-cm*gain; print('head colour gain',gain.round(3),'off',off.round(1))
seq=f'{work}/seq'; shutil.rmtree(seq, ignore_errors=True); os.makedirs(seq)
for k,p in enumerate(head_frames):
    fr=L(p)*gain+off
    out=warp(fr,prm,drift[k])
    Image.fromarray(np.clip(out+0.5,0,255).astype(np.uint8)).save(f'{seq}/{k+1:04d}.png')
# ---------------- MIDDLE (A from t=0, B) ----------------
As=extract('seg_sdA.mp4', f'{work}/A'); Bs=extract('seg_sdB.mp4', f'{work}/B', 0, 3.2)
MID=TOTAL-HEAD; nA=round(MID*0.70); nB=MID-nA
Ar=retime_map(As, np.linspace(0,len(As)-1,nA), f'{work}/Ar'); Br=retime_map(Bs, np.linspace(0,len(Bs)-1,nB), f'{work}/Br')
a0=G(L(Ar[0])); dA=smooth([pc(rg[band], G(L(p))[band])[0] for p in Ar])
b0=G(L(Br[0])); dB=smooth([pc(b0[band], G(L(p))[band])[0] for p in Br])+dA[-1]
ident=(0.0,0.0,0.0,0.0)
for k,p in enumerate(Ar):
    out=warp(L(p),ident,dA[k]); Image.fromarray(np.clip(out+0.5,0,255).astype(np.uint8)).save(f'{seq}/{HEAD+k+1:04d}.png')
for k,p in enumerate(Br):
    out=warp(L(p),ident,dB[k]); Image.fromarray(np.clip(out+0.5,0,255).astype(np.uint8)).save(f'{seq}/{HEAD+nA+k+1:04d}.png')
print('mid drift A:', np.round(dA,1).tolist()); print('mid drift B:', np.round(dB,1).tolist())
subprocess.run([ff,'-y','-v','error','-framerate','24','-i',f'{seq}/%04d.png','-an','-vf','format=yuv420p','-c:v','libx264','-preset','slow','-crf','17','-profile:v','high','-level','4.1','-movflags','+faststart','-r','24',f'out/{name}_video.mp4'],check=True)
subprocess.run([ff,'-y','-v','error','-i',f'out/{name}_video.mp4','-i','audio/mix_5s.wav','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',f'out/{name}_audio.mp4'],check=True)
# verification: residual shift vs refA in the left mountain band for every 6th frame across the whole video
print('VERIFY residual vs refA (left_mtn):', [(i, pc(rg[band], G(L(f'{seq}/{i:04d}.png'))[band])) for i in range(1,TOTAL+1,6)])
print('done')
