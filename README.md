# Cutroom

A browser-based video editor prototype built to answer two of Cardboard's
own hard problems with working code instead of claims:

1. **Version Control** — "Code has git. Video has nothing."
2. **Verification** — "There's no linter for video. We have to build one."

[Try the hosted editor](https://cutroom-shivamchavan01s-projects.vercel.app/).
Import your own footage; project data and media stay in your browser.
The hosted demo includes timeline editing, version control and verification.
The AI assistant currently requires the local server and is unavailable on
the static demo. Vercel builds the monorepo using `vercel.json` and deploys
the connected `main` branch. The checked GitHub Pages deployment remains
available as a [mirror](https://shivamchavan01.github.io/cutroom/).

## What works

- **Timeline engine** (`packages/engine`, pure TypeScript, no DOM): clips in
  an ID-keyed map, all edits through one `applyOp` reducer, op log with
  cursor undo/redo, blame derived from the log.
- **Diff + 3-way merge**: per-clip per-field merge, then a geometric overlap
  sweep that catches collisions a per-clip merge cannot see. Overlaps are
  surfaced, never auto-shifted. Delete-vs-edit is a conflict, not a silent
  delete. Same-point splits on two branches converge (deterministic IDs).
- **Linter**: `lint()` with a rule harness (`defineRule`) and 7 built-in
  structural rules — overlap, gap, missing-media, flash-frame,
  trim-past-source, zero-length, unused-asset. Severity is caller-assigned.
- **Web UI** (`apps/web`): a dark editorial workspace with searchable
  media, grid/list views, editable tags, footage/graphics/sequences tabs,
  a program monitor and a full-width timeline. Import video, audio and
  images; edit clip position, linked or independent scale, rotation, trim,
  start time and volume. Add video tracks, drag clips, hide/mute/lock tracks,
  zoom or fit the timeline, and use preview zoom/fullscreen. Clip, Sequence
  and Project inspector tabs include project naming and frame-rate settings.
  Resizable panels, verification, a Review drawer, command palette,
  undo/redo, blame and activity sit alongside commits, branches, a visual
  commit graph, diffs and merge conflict resolution. The version rail can
  fork a version while preserving current edits. The graph marks shared tips,
  merges and the viewed commit, with parent lines attached to their actual
  endpoints and ancestry-safe ordering across branches.
- **Detach audio**: select a video clip and use the timeline toolbar to
  place its audio on a free, unlocked audio track (A1 when available).
  Start time, source trim, duration and gain match; the video gain becomes
  zero so sound plays once. One undo restores both. Busy tracks are left
  intact, and a new audio track is created when needed. Audio and video
  are independently editable after detaching; no ongoing edit link or
  extracted audio file is created. Both refer to the original local media.
- **Layered preview**: per-track double-buffered native video/audio,
  image layers and CSS transforms. Video tracks composite in track order;
  playback continues across cuts and gaps. Workspace track visibility,
  mute and locks persist locally; creative edits are versioned.
- **Audio waveforms**: real decoded audio beneath video thumbnails and on
  audio clips, aligned with source trims and splits. Drawing follows zoom,
  viewport and clip volume; muted tracks dim the waveform. Peaks are
  normalized per source for visibility, not a live level meter. Decoding
  runs locally, one source at a time, with a shared cache. Sources above
  128 MB or 20 minutes, or without decodable audio, show an unavailable
  state; playback is independent. Waveforms regenerate after reload.
- **Four export formats** (engine-side pure functions): `.otio`
  (OpenTimelineIO), `.fcpxml` (Final Cut Pro XML), `.edl` (CMX3600) and
  a lossless `.cutroom.json`. The export menu names the tools each one
  opens in and what it loses. These are timelines, not rendered video —
  there is no video encoder. Native JSON preserves all timeline fields;
  OTIO preserves transforms as Cutroom metadata. EDL/FCPXML do not reproduce
  visual transforms.

## Numbers

Engine ops, measured on the dev machine (`vitest bench`, see PERF.md):

| op | 20 clips | 1,000 clips |
|---|---|---|
| applyOp | 0.002 ms | 1.17 ms |
| diff | 0.012 ms | 0.75 ms |
| merge clean | 0.08 ms | 5.75 ms |
| merge (field conflict) | — | 5.32 ms |
| lint | 0.013 ms | 0.58 ms |

Player stall and scrub latency: **pending headed-Chrome runs** — the
protocol is in `apps/web/headed.html`, retired headless numbers are
documented in PERF.md rather than cited.

## The CRDT / branch tradeoff, written down

Live collab (Yjs-style CRDT) and version control (git-style branches) solve
different problems and the boundary is deliberate: **CRDT auto-merge within
a branch, explicit merge across branches.** A CRDT converges keystrokes;
it cannot decide whose trim survives or whether an overlap is intentional.
Those need a human, a diff view, and a resolve button — which is what the
merge UI is. Collab infra (`apps/server`) is not built yet.

## Deliberate cuts

- **Transitions and effects rendering** — the preview layers native media
  with CSS transforms; there is no canvas/WebGL effects pipeline.
- **Pixel-level diff/merge** — by design, never planned. The engine tracks
  timeline structure; content edits must arrive as parameterized ops.
- **Auth** — localStorage guest identity; presence-ready, login-free.
- **Rust/WASM** — the engine is small JSON (see table); decoded media is
  the memory cost and browsers already decode natively. Revisit for pixel
  pipelines, not for this layer.
- **Yjs live collab + server** — architecture sketched in CONTEXT.md,
  not built.
- **Video rendering** — exports are timelines. There is no canvas/WebGL
  compositor and no encoder, so nothing here produces an MP4.

## Run it

```sh
pnpm install
# engine tests
./node_modules/.bin/vitest run packages/engine
# web tests
./node_modules/.bin/vitest run apps/web
# dev server (run vite directly; the pnpm wrapper trips on a build-approval check)
cd apps/web && ./node_modules/.bin/vite --port 5173
```

`pnpm install` prints an `ERR_PNPM_IGNORED_BUILDS` warning about esbuild —
harmless; the platform binary installs as an optional dep and everything
runs. Test media for the player checkpoint: drop two mp4s at
`apps/web/public/test-a.mp4` / `test-b.mp4` (gitignored, dev-only).

## Status

633 engine/web tests green (181 engine + 452 web/server), both TypeScript checks
and the production build pass. The separate measurement harness is checked with
Vitest (16 passing tests; 649 total across the three runs).
The [Day 1 correctness report](DAY1-REPORT.md) records reproductions,
browser evidence, merge policies and remaining persistence limitations. Honest
accounting of what's proven vs pending lives in CONTEXT.md, CARDBOARD-KB.md
(research notes), and PERF.md.

Tabs use the shadcn composition with Radix primitives for keyboard navigation,
focus and linked panels. The dark palette has text-contrast regressions;
verification colours and timeline lanes share the same emitted CSS tokens.

Browser regression checks live in `scripts/verify-editor.mjs`. They use
Playwright with installed Google Chrome and a fresh browser context for
each flow. Start the local editor, provide two short demo MP4s, and run:

```sh
EDITOR_URL=http://127.0.0.1:5186 \
TEST_VIDEO_A=/path/to/short-a.mp4 \
TEST_VIDEO_B=/path/to/short-b.mp4 \
node scripts/verify-editor.mjs
```

If Playwright is installed outside this repo, set `PLAYWRIGHT_MODULE` to
its absolute `index.mjs` path. The original-video check also uses
`apps/web/public/test-a.mp4`. The checks cover upload playback, media
restoration after refresh, playback across a cut, split and undo/redo,
merge conflicts, verification warnings and a persisted merge commit.
They also check preview fit and sidebar control bounds at desktop and
laptop widths.
Screenshots and observations are written to a fresh `.gstack/media-fix-*`
directory. These checks do not measure playback performance.

`scripts/verify-editorial.mjs` checks the editorial controls with real
media: search/tags, transforms, volume, track controls, trim/drag/zoom,
graphics, fullscreen, project settings, version creation, download and
refresh recovery. Use the same environment variables plus
`TEST_GRAPHIC=/path/to/image.jpg`.

`scripts/verify-waveforms.mjs` checks both AAC video sources, source offsets
after trim/split, playback, audio-lane waveforms, mute styling and reload.
Set `TEST_VIDEO_A` and `TEST_VIDEO_B` to the two demo MP4s, plus `TEST_AUDIO`
to a two-second WAV with silence in the first/last half-second and a tone
between them. It uses the same `EDITOR_URL`, `PLAYWRIGHT_MODULE` and
`QA_OUTPUT_DIR` options. The test awaits actual persisted data before reload.

## What it saves, and where

Project metadata (op log, undo cursor, commits, branches, HEAD state) goes
to IndexedDB; uploaded media goes to OPFS keyed by its content hash, so a
clip still plays after a refresh. Both are one browser, one project — no
project sync or sharing, and nothing encrypted. If the browser has no
private file system the app says so in the status bar rather than losing
your work quietly.

## AI verification assistant

Open **Issues → Explain issues with AI**, or **Assistant** in the sidebar.
The assistant explains structural findings and proposes edits. Each proposal
shows the clip changes and the findings it would resolve or introduce.
Nothing changes until you apply it. Applied operations use the existing
history and version workflow; Undo reverses one operation at a time.
Changed timelines invalidate previews, and track locks are checked again
when applying. Finish or cancel a merge before using the assistant.

Configure the key on this computer:

```sh
cp apps/web/.env.example apps/web/.env.local
# Edit .env.local: set GROQ_API_KEY, then restart Vite.
# The template selects AI_PROVIDER=groq and GROQ_MODEL=openai/gpt-oss-120b.
# Alternatively select AI_PROVIDER=openai and set OPENAI_API_KEY / OPENAI_MODEL.
```

Groq uses Chat Completions with a [strict JSON schema](https://console.groq.com/docs/structured-outputs).
GPT-OSS 120B is the default; choose another model supporting strict schema
output and the configured reasoning effort with `GROQ_MODEL`.
The optional [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
adapter uses `store: false`. Keys stay on the server; never use a `VITE_` prefix for
secrets. The request sends the prompt, timeline metadata (including asset
names) and verification findings. It sends no media bytes. This is structural
verification: the assistant cannot watch footage, hear dialogue, transcribe,
dub or generate missing media. Usage is billed to your configured provider
account. The panel reads the active provider from the local server and names
it in the data disclosure; configuration responses contain no credentials.

The endpoint works in Vite development and local `vite preview` after a build.
It accepts only local connections through `localhost`/`127.0.0.1`/`[::1]`,
checks request origins, limits request size and concurrent calls, and times
out upstream calls after 60 seconds. A static host alone cannot run this API;
public hosting needs a server with authentication and per-user credentials
or billing limits.

Supported proposals: move, trim, split, delete, volume and transform changes
to existing clips, up to 50 operations on timelines up to 1,000 clips.
Explanation-only responses are supported. New findings remain visible for
review; a proposal is not a guarantee that a cut looks or sounds right.

Server and client boundary tests use controlled provider responses. Reproduce
the browser workflow against the development server with a real demo video:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
TEST_VIDEO_A=/path/to/demo.mp4 node scripts/verify-assistant.mjs
```

This browser check substitutes the remote response and exercises the real
engine, preview, stale checks, apply, undo/redo, persistence, locks and cancel.
Live Groq checks with GPT-OSS 120B passed for a gap fix, locked-track
explanation and explanation-only request. The real gap proposal passed the
engine preview, apply, undo/redo and reload checks. These three cases are a
smoke test, not a broad model-quality benchmark. Live OpenAI remains unverified.
