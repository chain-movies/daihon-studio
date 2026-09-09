"""Assemble: head (final video 0-2.0s, frames 1-48) + new middle clip(s) retimed to fill 2.0-5.0s (72 frames),
final frame forced to the locked metallic frame (mm_frames/0090.png). Then mux the existing audio mix.
usage: python3 assemble.py OUTNAME clipA.mp4 [clipB.mp4 splitFrac]
  single clip: retime whole clip to 72 frames
  two clips : clip A gets round(72*splitFrac) frames, clip B the rest
"""
import sys, os, subprocess, shutil, glob, imageio_ffmpeg
ff=imageio_ffmpeg.get_ffmpeg_exe()
name=sys.argv[1]; clips=sys.argv[2:]
work=f'asm_{name}'; shutil.rmtree(work, ignore_errors=True); os.makedirs(work)
def retime(spec, nframes, tag):
    d=f'{work}/{tag}'; os.makedirs(d)
    parts=spec.split(':'); src=parts[0]; t0=float(parts[1]) if len(parts)>1 else 0.0; t1=float(parts[2]) if len(parts)>2 else None
    trim=f'trim=start={t0}'+(f':end={t1}' if t1 else '')+',setpts=PTS-STARTPTS,'
    subprocess.run([ff,'-y','-v','error','-i',src,'-vf',trim+'scale=1920:1080:flags=lanczos',f'{d}/s%04d.png'],check=True)
    n=len(glob.glob(f'{d}/s*.png'))
    # motion-interpolated retime to exactly nframes at 24fps
    subprocess.run([ff,'-y','-v','error','-framerate','24','-i',f'{d}/s%04d.png','-vf',f'setpts=PTS*({nframes}/{n}),minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1',f'{d}/r%04d.png'],check=True)
    out=sorted(glob.glob(f'{d}/r*.png'))
    # pad/trim to exact count using the last source frame
    while len(out)<nframes: 
        shutil.copy(f'{d}/s{n:04d}.png', f'{d}/r{len(out)+1:04d}.png'); out=sorted(glob.glob(f'{d}/r*.png'))
    return out[:nframes]
HEAD=48; TOTAL=120; MID=TOTAL-HEAD
if len(clips)==1:
    mid=retime(clips[0], MID, 'A')
else:
    fa=round(MID*float(clips[2])); mid=retime(clips[0], fa, 'A')+retime(clips[1], MID-fa, 'B')
seq=f'{work}/seq'; os.makedirs(seq)
for i in range(1,HEAD+1): shutil.copy(f'stretch_frames/{i:04d}.png', f'{seq}/{i:04d}.png')
import numpy as np
from PIL import Image
head_last=np.asarray(Image.open(f'stretch_frames/{HEAD:04d}.png').convert('RGB')).astype(np.float32)
end_img=np.asarray(Image.open('mm_frames/0090.png').convert('RGB')).astype(np.float32)
XF_IN=10; XF_OUT=12
for k,p in enumerate(mid):
    fr=np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
    if k < XF_IN:                       # dissolve from the last head frame into the new clip
        a=(k+1)/(XF_IN+1); fr=(1-a)*head_last + a*fr
    j=len(mid)-1-k
    if j < XF_OUT:                      # dissolve into the locked final frame
        a=(XF_OUT-j)/(XF_OUT+1); fr=(1-a)*fr + a*end_img
    Image.fromarray(np.clip(fr+0.5,0,255).astype(np.uint8)).save(f'{seq}/{HEAD+k+1:04d}.png')
shutil.copy('mm_frames/0090.png', f'{seq}/{TOTAL:04d}.png')   # locked final frame
subprocess.run([ff,'-y','-v','error','-framerate','24','-i',f'{seq}/%04d.png','-an','-vf','format=yuv420p','-c:v','libx264','-preset','slow','-crf','17','-profile:v','high','-level','4.1','-movflags','+faststart','-r','24',f'out/{name}_video.mp4'],check=True)
subprocess.run([ff,'-y','-v','error','-i',f'out/{name}_video.mp4','-i','audio/mix_5s.wav','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',f'out/{name}_audio.mp4'],check=True)
print('done', f'out/{name}_video.mp4', f'out/{name}_audio.mp4')
