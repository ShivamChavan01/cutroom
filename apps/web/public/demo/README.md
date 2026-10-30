# Cutroom sample media

`motion.mp4` contains original procedural motion graphics. `pulse.wav` contains
an original synthesized 220 Hz pulse. Both are generated entirely by
[scripts/make-demo-media.sh](../../../../scripts/make-demo-media.sh), using ffmpeg.
No recorded footage, external music, logos, or third-party video are included.
The MP4 contains the same synthesized sound; sample video clips are muted so
only the separate audio track is heard.

These generated media files and their original graphic/audio content are
dedicated to the public domain under CC0 1.0 Universal:
https://creativecommons.org/publicdomain/zero/1.0/
The generator uses the system DejaVu Sans font for rendered titles (no font file
is distributed). ffmpeg/libx264 are build tools, not bundled application code.

Both sources are 8 seconds long. MP4 uses H.264, yuv420p, 960 × 540, 30 fps,
AAC audio and fast-start metadata. WAV uses 16 kHz mono PCM. Together they are
under 400 KB. They load only in the optional sample workspace.

The timeline references SHA-256 asset IDs, checked against file contents by
`lib/demo/project.test.ts`. Rebuilding with another ffmpeg version can change
the encoded bytes: update the corresponding IDs in `lib/demo/project.ts`.
