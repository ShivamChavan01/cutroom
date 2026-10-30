#!/usr/bin/env bash
# Original procedural graphics and synthesized tone, dedicated to CC0.
# Rebuild from the repository root with ffmpeg (libx264 + drawtext).
set -euo pipefail
out=apps/web/public/demo
mkdir -p "$out"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'aevalsrc=0.12*sin(2*PI*220*t)*pow(sin(PI*2*t)\,8):s=16000:d=8' -c:a pcm_s16le "$out/pulse.wav"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'color=c=0x101719:s=960x540:r=30:d=8' -i "$out/pulse.wav" -vf "drawgrid=w=80:h=60:t=1:c=0x223335,drawbox=x=60:y=60:w=8:h=55:color=0x64e0ba:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='CUTROOM / MOTION STUDY':fontcolor=0xeaf4ef:fontsize=30:x=90:y=70,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='TIMING IS AN EDITING DECISION':fontcolor=0x8da6a2:fontsize=19:x=60:y=440,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='o':fontcolor=0x64e0ba:fontsize=140:x=390+270*sin(t):y=190+65*cos(t*2),drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{pts\\:hms}':fontcolor=white:fontsize=24:x=60:y=370" -c:a aac -b:a 48k -c:v libx264 -preset veryfast -crf 27 -pix_fmt yuv420p -movflags +faststart "$out/motion.mp4"
