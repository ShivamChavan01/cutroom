# Owned adversarial QA fixtures

QA only: these files do not fix or modify the application. The four minimal
regressions intentionally fail on `254fb52`. See `../../CUTROOM-ADVERSARIAL-QA.md`
for observations, GitHub issues, counts, production/local distinctions and limits.
All generated media and browser profiles go under `.gstack/adversarial-qa/`.
No personal project, credentials or paid AI request is required.

## Existing tools

Use the repository's Vitest and TypeScript, an installed Chrome, ffmpeg, Python 3
and an existing Playwright package. If Playwright is installed elsewhere:

```sh
export PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
```

No package installation or upgrade is part of this audit. The isolated tsconfig
extends the web compiler settings and explicitly loads its existing Vite ambient
declarations; it does not alter the production project's include paths.

## Synthetic media

The source is the repository's original CC0 procedural study and synthesized
sound (`apps/web/public/demo/README.md`). Looping/transcoding and a free padding
box create the audit variants; no external footage is used.

From repository root, with an initially empty owned media directory:

```sh
mkdir -p .gstack/adversarial-qa/media
cp apps/web/public/demo/motion.mp4 .gstack/adversarial-qa/media/small.mp4
cp apps/web/public/demo/pulse.wav .gstack/adversarial-qa/media/audio.wav
ffmpeg -v error -stream_loop -1 -i apps/web/public/demo/motion.mp4 -t 20 -c copy .gstack/adversarial-qa/media/long.mp4
ffmpeg -v error -i apps/web/public/demo/motion.mp4 -t 3 -an -c:v libvpx-vp9 -deadline realtime -cpu-used 8 .gstack/adversarial-qa/media/sample.webm
python3 - <<'PY'
from pathlib import Path
import struct
p = Path('.gstack/adversarial-qa/media')
b = (p / 'small.mp4').read_bytes()
padding = 64 * 1024 * 1024 - len(b)
with (p / 'large.mp4').open('wb') as output:
    output.write(b)
    output.write(struct.pack('>I4s', padding, b'free'))
    output.truncate(64 * 1024 * 1024)
(p / 'corrupted.mp4').write_bytes(b'not an mp4 stream')
(p / 'zero.mp4').write_bytes(b'')
(p / 'unsupported.bin').write_bytes(b'unsupported synthetic fixture')
PY
```

The 64 MiB file has short/simple footage and stresses file size, not long-form
codec complexity. Reusing the exact bytes reproduces the hashed IDs in evidence.

## Runs

Start the existing local development server on 5186. Production scripts default
to the named Vercel origin in isolated profiles; no project is written to a
server. To use the local production build for supported scripts:
`EDITOR_URL=http://127.0.0.1:5187/`.

```sh
TMPDIR=$PWD/.gstack/tmp ./node_modules/.bin/vitest run qa/adversarial --maxWorkers=2
./node_modules/.bin/tsc -p qa/adversarial/tsconfig.json --noEmit
node qa/adversarial/production-issues.mjs
node qa/adversarial/production-walkthrough.mjs
node qa/adversarial/functional-browser.mjs
node qa/adversarial/extra-browser.mjs
node qa/adversarial/browser-stress.mjs
node qa/adversarial/checkout-stress.mjs
```

The complete Vitest audit run is expected to exit unsuccessfully on the current
revision because media retention fails; do not skip or weaken that test.
Graph seeds are 1–1000, operation seeds 10001–11000. Failure names retain the seed.
The oracle is independent transitive closure, not a call back into merge-base
selection. Stress samples exclude one warm-up and retain five measured calls.

Expected-failing minimal browser regressions:

```sh
node qa/adversarial/drop-quota.regression.mjs
node qa/adversarial/import-race.mjs
node qa/adversarial/save-race.regression.mjs
```

`media-browser.mjs` records the real Delete/Undo disappearance twice and the
picker/drop storage-warning A/B control. It records observations rather than
asserting that the known defects are fixed. The minimal regression scripts do
assert the correct behavior and fail. Fault hooks are installed only inside
owned browser contexts and disappear when those contexts close.

Browser stress uses stable scoped selectors so accessibility-tree scanning does
not masquerade as application latency. Its timing includes browser automation
and rendering checks and uses the development build. Production correctness
checks and local performance measurements are intentionally separate.
