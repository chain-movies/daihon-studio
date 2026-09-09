import subprocess, imageio_ffmpeg, numpy as np
ff=imageio_ffmpeg.get_ffmpeg_exe()
V='../fv_homare_E_main_1920x1080.mp4'
D='./'
# (file, start_time_in_video_s, trim_head_s, gain_dB, fade_in_s, fade_out_at_s_or_None)
layers=[
 (D+'music_184_Vastness.mp3',                 0.00, 0.0, -14.0, 0.6, None),   # low drone bed (C1-)
 (D+'sfx_2343_Cinematic_whoosh_magic_gust.wav',1.80, 0.0, -13.0, 0.4, None),  # riser through ribbon/swirl, peaks at 4.5s (C2-C3)
 (D+'sfx_3109_Relaxing_bell_chime.wav',       1.95, 0.0,  -9.0, 0.0, None),   # single bell strike at sunrise (C2)
 (D+'sfx_2586_Magical_light_sweep.wav',       2.20, 0.9, -12.0, 0.05,None),   # brush stroke of light, peaks ~2.9s (C2)
 (D+'sfx_658_Choir_magic_shine.wav',          4.35, 0.0, -14.0, 0.05,None),   # shine on formation (C4)
 (D+'sfx_867_Fairy_glitter.wav',              4.42, 0.0, -11.0, 0.0, None),   # metallic glitter on formation (C4)
]
inputs=[]; chains=[]
for k,(f,st,trim,g,fi,fo) in enumerate(layers):
    inputs += ['-i', f]
    c=f'[{k}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
    if trim>0: c+=f',atrim=start={trim},asetpts=PTS-STARTPTS'
    if fi>0: c+=f',afade=t=in:st=0:d={fi}'
    c+=f',volume={g}dB,adelay={int(st*1000)}|{int(st*1000)}[a{k}]'
    chains.append(c)
n=len(layers)
mix=''.join(f'[a{k}]' for k in range(n))+f'amix=inputs={n}:normalize=0:duration=longest,atrim=0:5.0,afade=t=out:st=4.62:d=0.38,loudnorm=I=-17:TP=-1.5:LRA=9:linear=true:print_format=summary,atrim=0:5.0,asetpts=PTS-STARTPTS[mix]'
fc=';'.join(chains+[mix])
# 1) mixed audio stem (wav)
r=subprocess.run([ff,'-y','-hide_banner','-loglevel','info']+inputs+['-filter_complex',fc,'-map','[mix]','-ar','48000','mix_5s.wav'],capture_output=True,text=True)
print('\n'.join([l for l in r.stderr.splitlines() if 'Input Integrated' in l or 'Output Integrated' in l or 'True Peak' in l or 'Error' in l or 'error' in l.lower()]))
# 2) mux with the locked video (video stream copied untouched)
subprocess.run([ff,'-y','-hide_banner','-loglevel','error','-i',V,'-i','mix_5s.wav','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart','../fv_homare_E_main_audio_1920x1080.mp4'],check=True)
subprocess.run([ff,'-y','-hide_banner','-loglevel','error','-i','../fv_homare_E_main_1920x1080.webm','-i','mix_5s.wav','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','libopus','-b:a','128k','-shortest','../fv_homare_E_main_audio_1920x1080.webm'],check=True)
# 3) verify: envelope of the final mix every 0.25s
x=np.frombuffer(subprocess.run([ff,'-v','error','-i','mix_5s.wav','-ac','1','-ar','48000','-f','f32le','-'],capture_output=True).stdout,dtype=np.float32)
n=12000; m=len(x)//n; e=np.sqrt((x[:m*n].reshape(m,n)**2).mean(1)+1e-12)
print('dur',len(x)/48000,'peak',20*np.log10(np.abs(x).max()))
for i,v in enumerate(e): print(f'{i*0.25:4.2f}s {20*np.log10(v):6.1f} dB '+'#'*int(max(0,60+20*np.log10(v))))
# waveform picture
subprocess.run([ff,'-y','-hide_banner','-loglevel','error','-i','mix_5s.wav','-filter_complex','showwavespic=s=1600x300:colors=#d4a84a','-frames:v','1','mix_wave.png'])
