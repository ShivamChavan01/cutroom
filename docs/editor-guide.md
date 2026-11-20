# Editor and developer guide

For a tour of the editor and the November release, start with the [Cutroom overview](../README.md).

## Try the sample project

Choose **Try the sample project** in the empty preview of the hosted editor, or run
`pnpm dev` to open it locally. The sample includes its own footage and works without an AI access code.

1. Choose **Try the sample project**. A separate sample tab opens with an eight-second
   original motion study, three video clips, and an audio bed. Press Play.
2. Open the project menu beside the Cutroom logo, choose **Sample guide**, then **See two versions**. Switch between `main` and `alternate`, or open
   **Graph** to see their shared ancestor and independent commits.
3. Choose **Compare edits**. The real timeline diff shows moves and a trim.
4. Choose **Merge versions**. Main moves `middle` to 3–5 seconds; alternate moves
   `ending` to 4–6 seconds. Each version has no overlaps, but their combination
   creates a genuine 4–5 second collision on V1.
5. Choose **Keep middle** or **Keep ending**. This explicitly removes the other
   clip; neither clip shifts automatically. Enter a message and **Commit merge**.
   The commit records both parents. Unresolved conflicts block the commit.
6. Choose **Inspect findings**. The actual linter reports a gap. Click the finding
   to locate it. Gaps may be intentional: verification asks for review, not an
   automatic creative decision. **Assistant** can explain findings if reviewer
   access is available.

The guide is optional and skippable. **Reset sample** asks for confirmation and
restores only the sample. If you change the scenario, use Versions to explore your
edits or reset before repeating the guide.

### Data isolation and refresh

- Your existing project remains in its original tab. The sample uses the
  `?demo=1` workspace, IndexedDB key `current.demo-v1`, and OPFS directory
  `media.demo-v1`; personal storage remains `current` and `media`.
- Track preferences and resized panel layouts are also separated. Loading,
  editing, or resetting the sample never clears personal IndexedDB or media.
  The **Personal workspace** link opens a personal tab; your original tab remains
  available with its working edits.
- Sample commits, edits, undo history, and uploaded media restore after refresh.
  Wait for **saved** before refreshing. Pending merges also restore after **saved**, including recorded resolution
  choices. Restore replays choices through the engine and validates version
  references. Stale or malformed merge data is canceled with a recovery notice;
  saved versions and working edits remain available. Cancel is always explicit
  for a valid merge. Merely reloading never commits it.
  Save completion acknowledges its captured history, branch graph and pending
  merge only. Writes are queued before opening IndexedDB, so an older delayed
  write cannot replace a newer snapshot.
- Commit working edits before merging, including tag changes. A source already
  included in the current version is an **Already up to date** no-op. If the
  current version is an ancestor of the source, merging fast-forwards the branch
  to that existing commit without creating a merge commit. Divergent versions
  retain the explicit conflict-review workflow above.
- Tag changes participate in Undo/Redo and saved version snapshots. Importing a
  source keeps it in the media library when its clip is undone. Reimporting the
  same content adds another clip without overwriting its existing name or tags.
  Context-free saves use internal project schema 2; saves with production
  context use schema 3. This build reads schemas 1, 2 and 3. Older builds cannot
  read schema 3. Timeline export formats are unchanged.
- Clip authors in the inspector and timeline survive checkout and reload.
  They trace the latest clip-changing commit; working differences use the latest
  active clip operation. An unchanged merge-parent clip keeps its attribution;
  a newly combined clip credits the merge author. Identical parent snapshots
  prefer the first parent. This is snapshot provenance, not field-level Git blame.
- Deleting a timeline clip retains its source file for Undo, the media library
  and saved versions. Clip deletion does not reclaim disk space. Automatic
  unused-file collection is deferred rather than risking recoverable footage.
- File-picker and timeline-drop imports report skipped files and storage
  failures in the editor. Switching versions, viewing an old commit, restoring
  a session or resetting during import cancels the remaining import with a
  message. Import again in the desired version. Ordinary edits and commits in
  the same version can continue while media loads. A write already in progress
  may leave a cached file even if its import is canceled.
- Bundled media is served from this app and restored without OPFS. New uploads
  use the active workspace's OPFS directory. Resetting the sample resets project
  state, retaining uploaded sample files in that isolated directory. Browser
  storage is local to this origin/device, subject to browser quota and eviction.
  Checking out a version or fast-forwarding also restores its locally stored
  media. Missing or evicted files still require reimporting; browser storage
  cannot recover media that is no longer on disk.
  Tabs do not synchronize live. Each write and reset atomically compares the
  stored project with that tab's last observed snapshot. A stale tab cannot
  overwrite or delete newer saved work: it shows **save failed** and keeps its
  candidate in memory. Export its timeline before reloading to load the newer
  saved project. IndexedDB upgrades to version 2 without rewriting the project
  records or media; version-one clients can no longer open it to perform unsafe
  writes. Reload older tabs after exporting any unsaved edits. This protects
  saved history; it does not merge tabs automatically. IndexedDB remains version 2.
- Media is self-created procedural graphics and synthesized sound, under CC0.
  See [provenance and regeneration instructions](../apps/web/public/demo/README.md).
  The two sources total under 400 KB and are requested only in the sample.

### Context-aware gain suggestions

Split one audio source into at least four clips on the same audio track. In
**Properties → Audio**, manually set three distinct clips to the same
gain, then select a fourth clip. Cutroom offers a gain match with the supporting
clip IDs and times. **Preview gain match** shows the before/after value without
editing. **Apply gain match** creates one ordinary operation; one Undo reverses it.

Suggestions use completed manual gestures from this session. Slider ticks and
keyboard repeat count as one decision until release or blur. The latest three
eligible distinct decisions must agree. Applied proposals and restored history
do not become manual evidence. This matches linear gain within a source; it does
not measure or normalize loudness.

Dismissal and immediate Undo suppress that offer until new supporting manual
evidence appears. **Suggest gain matches** disables suggestions and clears their
session context. Locked tracks, playback, pending merges, changed supporting
clips and stale previews prevent application. Checkout, forks and restored
sessions clear the evidence; committing retains it but invalidates old previews.

The context is bounded to 32 completed decisions, 32 suppressions and 64 feedback
events, held in memory. It sends no model requests and is not saved in project
history. This first prediction rule covers gain matching. General next-action
prediction and model ranking remain unimplemented.

### Review a production brief, reference direction and continuity

Open **Assistant** at the top right, choose **Brief & references**, and enter
the **Production brief**. Expand **Add direction
or requirements** to add reference-style directions, continuity instructions
or a maximum deliverable duration. Save the brief before requesting or applying
edits. Select a clip and choose **Protect selected picture** or **Protect
selected audio** to require its source range to remain in the cut.

The production context belongs to the project and stays available across
timeline branches and reloads. Timeline Undo does not undo brief changes.
**Import or export source evidence** accepts a production-context JSON document
with authored transcripts, shot notes, continuity notes and source ranges.
Export preserves those inputs independently of timeline interchange export.
The [authored sample context](../examples/production-context.demo.json) works with
the bundled demo project. It is explicitly a fixture, not footage analysis.

With a saved brief, sending a question assembles bounded
context from the brief, every requirement, reference directions, selected and
supporting clips, and retrieved evidence. It reports omitted notes and clips.
**Inspect request context** shows the evidence, source times and omissions
before sending the request.
Explicitly referenced evidence and mandatory context are never silently dropped;
an insufficient budget produces an error. This path does not have the legacy
whole-timeline assistant's 1,000-clip limit.

Proposal review shows duration, protected-range and source-sequence checks.
Apply rejects regressions in required constraints, including muting protected
audio. Split clips can satisfy a protected range when they retain continuous
source placement. Ambiguous repeated takes and absent source metadata require
review. **Show changes on timeline** marks proposed edits while the viewer plays
the current cut. Scrubbing keeps the proposal available, and pausing playback
enables Apply again if the proposal is still current. Changes to the timeline,
selection, version, locks, session or saved brief invalidate the proposal.
Applied operations still use ordinary Undo.

Reference style and visual continuity remain human judgments. Imported notes
are user-provided evidence; no automatic transcription, scene understanding or
style analysis runs here. Placement checks do not establish rendered quality,
physical media availability, preview mute/hide state or perceptual continuity.
The next-action predictor remains the gain baseline above. This context layer
currently supports user-requested assistant review.

See [the production context contract](production-context.md) for the format,
ownership, compatibility and verification scope.

### Assistant and export availability

The hosted assistant uses the provider reported by `/api/assistant/config`
on the current deployment. Request a reviewer access code from the project
owner. Credentials stay on the server; the access code stays in panel memory
until reload/unmount. The sample works without AI. Loading, unavailable,
access-required, request, provider-error and proposal-review states are explicit.
No prerecorded response is presented as a live model result. The assistant sees
structured timeline information and findings, not footage or audio.

**Export timeline** downloads OTIO, FCPXML, EDL or native JSON. It does not render
an MP4, package source media, or export the complete commit graph.

Desktop editing is checked at 1440×900, 1366×768, 1280×800 and 1024×768. Panels
remain resizable; larger monitors give the preview and inspector more room.
Narrow screens show a desktop notice: full mobile editing is not supported.
Structural checks do not prove visual/audio quality or frame-accurate playback.
See [demo limitations](../DEMO-LIMITATIONS.md). Vercel builds the monorepo using `vercel.json` on `main`;
the [GitHub Pages static mirror](https://shivamchavan01.github.io/cutroom/) has no
AI endpoint.

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
  a program monitor and timeline that share the editing column. Import video, audio and
  images; edit clip position, linked or independent scale, rotation, trim,
  start time and volume. Add video tracks, drag clips, hide/mute/lock tracks,
  zoom or fit the timeline, and use preview zoom/fullscreen. Clip, Sequence
  and Project tabs in Properties include project naming and frame-rate settings.
  Media, Versions, Issues, Properties and Settings open from the left rail.
  Assistant opens in a full-height, resizable panel on the right. Resizable panels, an Activity drawer, command palette,
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
  opens in and what it loses. The separate editing-copy encoder prepares individual source files. Native JSON preserves all timeline fields;
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

For measured seek latency, buffer recovery and full-resolution editing-copy results, see the [browser benchmarks](../PERF.md#source-resolution-playback-and-editing-copies).

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
- **Yjs live collab + server** — not built.
- **Video rendering** — exports are timelines. The optional MP4 editing copy contains one source video. Finishing a sequence requires a separate rendering tool.

## Run it

Use Node.js 24 and the pnpm version pinned in the root package. Run from the
repository root.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

The guided sample includes its media. To run the same unit tests as CI, use
`pnpm exec vitest run packages/engine apps/web scripts/measure-editor-performance.test.mjs`.
The standalone player checkpoint accepts two local MP4 files at
`apps/web/public/test-a.mp4` and `apps/web/public/test-b.mp4`.

## Status

The November 21 release passed 746 web tests and 220 engine and measurement-script tests. GitHub CI passed typechecking, tests and the production build. The Vercel smoke check verified the public editor, its JavaScript bundle, sample video and Assistant configuration endpoint. Model responses in local workflow tests use controlled fixtures. [Release workflow](https://github.com/ShivamChavan01/cutroom/actions/runs/44811133890) · [Project progress](../PROGRESS.md) · [Demo limitations](../DEMO-LIMITATIONS.md)

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

Open **Assistant** at the top right or choose **Issues → Explain issues with AI**.
The conversation opens to the right of the preview and timeline. Enter sends
and Shift+Enter inserts a line break. **Brief & references** opens the brief,
reference directions, requirements and source evidence. Its Save action stays
visible while the form scrolls. Choose **Close Assistant** to widen the preview. Reopening Assistant restores your question and drafts.

Conversation stays in memory during this page session. Requests include at
most 12 recent messages within 12,000 characters, alongside current project
context. Save lasting instructions in Context; conversation and unsaved drafts
are cleared by reload or project reset. Saved context persists across reloads.

The assistant explains structural findings and proposes edits. Each proposal
shows the clip changes and the findings it would resolve or introduce.
**Show changes**, **Apply**, and **Dismiss** stay beside the input even when
replies are long. Preview opens the proposed timeline comparison without
changing the cut. Nothing changes until you apply it. Applied operations use the existing
history and version workflow; Undo reverses one operation at a time.
Changed timelines invalidate previews, and track locks are checked again
when applying. Finish or cancel a merge before using the assistant.

For the hosted demo, enter the project owner's **Assistant access code** in
the Assistant panel. This is a separate demo credential, not a provider API key;
the panel holds it in memory until reload. The request uses an Authorization
header and never includes the code in model context.

For local development, configure the provider key on this computer:

```sh
cp apps/web/.env.example apps/web/.env.local
# Edit .env.local: set GROQ_API_KEY, then restart Vite.
# The template selects AI_PROVIDER=groq and GROQ_MODEL=openai/gpt-oss-120b.
# Alternatively select AI_PROVIDER=openai and set OPENAI_API_KEY / OPENAI_MODEL.
# For River select AI_PROVIDER=river and set RIVER_API_KEY / RIVER_MODEL.
```

Groq uses Chat Completions with a [strict JSON schema](https://console.groq.com/docs/structured-outputs).
GPT-OSS 120B is the default; choose another model supporting strict schema
output and the configured reasoning effort with `GROQ_MODEL`.
River is also supported through its [Chat Completions API](https://docs.river.ai/guides/inference/)
with strict JSON schema output. Set `AI_PROVIDER=river` and `RIVER_API_KEY`;
`RIVER_MODEL` defaults to `deepseek-ai/DeepSeek-V4.1-Flash-1017`.
The existing Vercel `MODEL_API` secret is also accepted for River if
`RIVER_API_KEY` is empty; it is never used for Groq or OpenAI.
`zai-org/GLM-5.3-Flash` is an alternative to evaluate. The adapter requests
low reasoning where supported, and disables reasoning for Kimi-K3/Nemotron,
which do not accept `low`. It uses River's `max_tokens` parameter, and rejects
truncated or refused answers before previewing a proposal. Boundary tests use
controlled responses. A live River smoke check on 2026-10-30 passed a move
proposal with preview/apply/undo/redo/refresh, explanation-only output, and
locked-track refusal using DeepSeek-V4.1-Flash-1017. These cases do not establish
general model quality; the other River models have not been tested live here.
The optional [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
adapter uses `store: false`. Keys stay on the server; never use a `VITE_` prefix for
secrets. The request sends the prompt, timeline metadata (including asset
names) and verification findings. It sends no media bytes. This is structural
verification: the assistant cannot watch footage, hear dialogue, transcribe,
dub or generate missing media. Usage is billed to your configured provider
account. The panel reads the active provider from the server and names
it in the data disclosure; configuration responses contain no credentials.

The endpoint works in Vite development and local `vite preview` after a build;
these remain limited to `localhost`/`127.0.0.1`/`[::1]`. On Vercel,
`api/assistant/[action].ts` runs the same handler as a Node.js Function.
Set `AI_PROVIDER`, the matching key/model variables, and `ASSISTANT_ACCESS_CODE`
as server-side Production environment variables, then redeploy. Without an
access code, hosted proposals fail closed. Preview environments need their
own variables before the assistant can be used.

Both modes check request origins, bound request size and model output, and
time out upstream calls after 60 seconds. Concurrent proposals are limited
per server instance; this is not a global rate limit or spending cap. The
shared code is intended for a small reviewer demo; rotate it in Vercel when
needed and configure usage limits with the provider. Static hosting alone
cannot run this endpoint.

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

The Vercel Groq smoke check also passed on 2026-10-29: configuration, rejected
missing/incorrect access codes, cross-origin rejection, a real move proposal
without premature mutation, explicit apply, undo/redo, and refresh restoration.
The access code was cleared on refresh and no browser runtime errors occurred.
