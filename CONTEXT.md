# Cutroom — Context

## What this is

A browser-based video editor prototype, built to apply for the **Fullstack
Engineer role at Cardboard** (cardboard.ai — YC-backed, AI-native video
editor in the browser). It is the proof, not an afterthought to the
application.

## Why this exists

Cardboard's JD centers on browser media engineering (real-time editing,
large media on the client, an AI agent that makes real edits) and points to
a public "hard problems" doc. Shivam's background is end-to-end ownership
plus LLM/agent systems (VoiceScope, MCP Foundry) with zero prior browser
media experience (canvas, WebCodecs, large binary client state). Strategy:
don't paper over the gap — close part of it in public.

**The bet:** pick two of Cardboard's own named hard problems — **Version
Control** and **Verification** — and build working, tested proof against
them. Both are systems/logic problems (merge semantics, conflict detection,
timeline linting), which plays to existing strengths even without prior
video experience.

## The two hard problems

From Cardboard's hard-problems doc:

1. **Version Control** — "Code has git. Video has nothing... What does a
   diff even look like for a timeline? How do you present a conflict in a
   way an editor can resolve without friction?"
2. **Verification** — "There's no linter for video. We have to build one."

## Architecture

```
                    ┌──────────────── Browser (per user) ────────────────┐
                    │                                                    │
                    │  UI (React)   timeline, player, diff view,         │
                    │               merge/conflict view, presence        │
                    │      │                                             │
                    │  Store (Zustand)                                   │
                    │      │                                             │
                    │  ENGINE (pure TS, no DOM, no React)                │
                    │   model · ops · reducer · undo · diff · merge      │
                    │   lint · otio · export                             │
                    │      │                         │                   │
                    │  Sync layer (Yjs)          Media layer             │
                    │   PLANNED, not built        OPFS cache, worker      │
                    │      │                     thumbnails, proxy/full  │
                    └──────┼─────────────────────────┼───────────────────┘
                           │ WebSocket               │ HTTP range requests
                    ┌──────┴─────────────────────────┴───────────────────┐
                    │  Server (Node + TS)   PLANNED — not built          │
                    │   y-websocket relay · commit/branch API (SQLite)   │
                    │   blob store keyed by hash · ffmpeg proxy job      │
                    └────────────────────────────────────────────────────┘
```
Everything marked PLANNED is a design sketch, not code: there is no
`apps/server` package, no Yjs dependency, and no sync path. The browser
side is the whole system today — one browser, one project, no sharing.

**Repo layout:**
```
/packages/engine    pure TS: model, ops, diff, merge, lint, otio, timecode,
                   export/ (edl, fcpxml, cutroom) + tests (Vitest)
/apps/web           React + Vite + Tailwind: editor shell, timeline, player,
                   diff/merge views, commit graph, export, persistence
/apps/server        Node: y-websocket, REST, SQLite, blob store
                   (PLANNED — not built; the directory is empty)
```

### Key design decisions and why

- **Timeline is a clip-ID-keyed map, not an array.** Position in an array
  makes "moved" and "added + removed" indistinguishable. Keying by stable
  identity makes position a *field of the clip* (`start`), which is what
  makes diff and merge tractable.
- **State only changes through Ops** (`addClip`, `splitClip`, `trimClip`,
  `moveClip`, `deleteClip`, `setVolume`), applied through one single
  `applyOp` reducer. One function, so authorship/history never drifts.
  Invalid ops throw loudly instead of silently no-oping — a silently dropped
  op is indistinguishable from a lost one three commits later.
- **Split produces deterministic child IDs** (parent ID + split point +
  side + short hash). Two branches splitting the same clip at the same
  point converge on the same IDs instead of a false conflict. Sub-ms
  points are rounded to integer ms first.
- **Split and delete compose:** deleting a split parent cascades to its
  children (matched by `parentId~` prefix); re-applying an already-applied
  split is a no-op. Deleting a truly unknown ID still throws.
- **Merge happens in two passes:** per-clip per-field 3-way merge, then a
  geometric overlap sweep on the merged result. Pass 2 is necessary because
  two *individually valid* changes (on different clips) can still collide
  on the same track — a per-clip merge alone misses this. There is a test
  proving pass 1 sees nothing while pass 2 catches it.
- **Never auto-resolve overlaps by silently shifting clips.** Retiming
  someone's edit without asking is the one thing an editor won't forgive.
  Conflicts are surfaced for explicit user resolution.
- **Both-sides-delete converges cleanly.** Concurrent same-ID adds with
  identical content converge; with genuinely different content they produce
  per-field conflicts — never a silent pick.
- **Delete-vs-edit is a conflict, not a silent delete.** A one-sided delete
  only applies cleanly if the surviving side is byte-identical to base;
  otherwise it's a `deleteModify` conflict and the survivor stays visible
  so work is never silently lost.
- **Live collab (Yjs) happens within a branch; merging across branches is
  explicit**, git-style. Deliberate boundary between CRDT auto-merge and
  version-control explicit merge.
- **Assets are content-addressed** (`id = sha256(file)`). Timeline structure
  travels first, media follows; a clip can exist before its file is local
  ("not local yet" UI state). Small honest slice of "large asset sync".
- **No Rust/WASM for this build.** The memory bottleneck on a 5.7GB machine
  is decoded media (handled by WebCodecs/ffmpeg.wasm at native speed); the
  timeline engine is small JSON. Phase-2 interview answer, not week-1 work.

## Status

**Built, tested, committed (`195c406` + `33542f3`):**
- `packages/engine/src/model.ts` — timeline data model
- `packages/engine/src/ops.ts` — Op types + single `applyOp` reducer,
  deterministic split IDs, split/delete composition
- `packages/engine/src/history.ts` — op log + cursor undo/redo, blame
  derived from the log
- `packages/engine/src/diff.ts` — clip-level diff
  (added/removed/moved/trimmed/edited)
- `packages/engine/src/merge.ts` — 3-way field merge + overlap pass,
  `resolveField`, `overlappingPairs`
- `packages/engine/src/lint.ts` — Verification linter: `Diagnostic`,
  `Rule`, `defineRule` harness, `lint()` with include/exclude/severity
  overrides, 7 built-in rules (overlap, gap, missing-media, flash-frame,
  trim-past-source, zero-length, unused-asset). Deliberate swap: `clipping`
  dropped because `setVolume` already rejects out-of-range values — a rule
  that can never fire is decoration. Severity is caller-assigned, so
  proxy-first workflows can downgrade missing-media to a warning
  - **Diagnostic identity**: every diagnostic carries a `key` —
    `rule | sorted root clip ids | subject`. Root clip ids (the part before
    `~`) mean a split child is recognised as the same problem its parent
    had, so splitting never manufactures a phantom "resolved + introduced".
    The message and position are deliberately *not* in the key, so a moved
    clip keeps its identity.
  - **`lintDelta(before, after, options?)`** → `{ introduced, resolved,
    unchanged }` — what a change does to the linter's findings. Counts are
    of *identities*, not raw diagnostics: a split that leaves both children
    overlapping the same clip yields two diagnostics sharing one key, and
    for "does this make the project worse?" one identity is the right unit.
  - Defect-injection tests: 6/6 injected defects caught (overlap, gap,
    missing-media, trim-past-source, zero-length, flash-frame), 0 false
    alarms on a clean timeline.
- `packages/engine/src/otio.ts` — OpenTimelineIO export/import
- `packages/engine/src/timecode.ts` — canonical `formatTimecode` /
  `frameAt` / `msFromFrame`. Lives in the engine because the export
  formats need it too; the web re-exports it so there is one
  implementation, not two that drift.
- `packages/engine/src/export/` — **multiple export formats**, all pure
  engine functions so they are testable without a browser:
  `edl.ts` (CMX3600), `fcpxml.ts` (Final Cut Pro XML — one `<spine>` per
  track inside a `<story>`, which is how Final Cut stores parallel
  tracks), `cutroom.ts` (lossless native JSON, versioned, with an
  importer), and `index.ts` — the `EXPORT_FORMATS` registry the UI
  renders. Adding a format = one serializer + one registry entry.
- 136 engine tests green (including 35 editorial feature regressions),
  `tsc --noEmit` clean
- Tests cover: split determinism across branches, clean merge, field
  conflict, the overlap case a naive merge misses, no auto-shift,
  delete-vs-modify, concurrent-add conflict, asset-bounds rejection,
  malformed-clip rejection, EDL event/track mapping, FCPXML story
  structure + XML escaping + parseable-XML check, Cutroom file
  round-trip and version rejection

**Built, browser-tested (`apps/web`, committed through `33542f3`):**
- Zustand store over engine `History` (dispatch/undo/redo/select/playhead/zoom), narrow selectors
- **Editor shell** (dark editorial layout): labeled Media / Versions / Issues / Settings
  tabs switching the media browser, resizable panels via
  `react-resizable-panels` (monitors/sequence and library/viewer/properties)
  with sizes persisted per group id in localStorage. A full-width timeline
  sits below the monitors, with editor tabs (Timeline | Diff | Merge).
  A collapsible Review drawer contains Issues/Activity tabs. Status line
  (branch, dirty state, issue count,
  timecode, author), Ctrl+K command palette (fuzzy subsequence filter,
  unit-tested)
- Timeline: toolbar (split/delete/zoom), ruler with timecode, V1/A1 track
  headers, **draggable playhead** with a handle (pointer + arrow keys,
  `role="slider"`). `data-timeline-lane` kept on the real lane so
  `headed.html` still measures the real timeline.
- Player: per-track double-buffered native video/audio plus image layers
  and CSS transforms. The hidden element is warmed to
  `readyState >= 4` on inPoint ~1s before each boundary, roles flip at the
  cut, swap decisions (`decideSwap`/`decideWarm` in `lib/swap.ts`) unit-tested
  (14 tests). Replaced an earlier single-element design whose preload was a
  verified no-op. Stall metric: boundary tick → new element's `playing`
  event, logged `(preload on/off)`; headed measurement still pending
- Preview region: large player + transport with `HH:MM:SS:FF` timecode,
  play/pause and **previous/next cut** buttons (pure `previousCut` /
  `nextCut`, unit-tested), Fit/100%/50% preview sizing and fullscreen.
- Interactions: split at playhead (button + `S`), delete (`Delete`), edge-drag trim (one op on release, clamped), shortcuts, author identity in localStorage
- Diagnostics overlay: `lint()` memoized per timeline, clip markers + panel with click-to-jump
- Blame + activity feed: `authorsByClip` fanned to clips (author color dots), op log rendered as a session transcript (✓ applied / ↩ undone, author dots, `#seq`)
- Video upload: file picker + timeline drop zone → sha256 asset id → duration probe → `addAsset` (rides history base, log untouched) → clip appended on V1
- Git workflow (`vcs.ts` + store + UI): commits snapshotting timelines, branches as head pointers, checkout with dirty guard, merge with base-finding and per-conflict resolution (field/deleteModify/overlap), 2-parent merge commits
- **Commit checkout (detached HEAD)**: click any commit to check it out and
  watch that snapshot — the timeline rewinds to it and plays. Commit is
  blocked while detached (git semantics), branches can fork off a viewed
  commit, `back to <branch>` returns. 5 tests cover the semantics.
- **Visual commit graph** (Versions panel → Graph tab): lanes, per-branch
  line colours, branch badges, click a dot to check that version out.
  Lane assignment is *branch-based*: main keeps lane 0 and side branches
  fork right, independent of checkout. 14 layout tests and 2 component
  tests cover ordering, forks, merged/deleted branches, stable checkout,
  HEAD labels and shared tips.
- Colour-coded diff view on the timeline: added/removed/moved/trimmed/edited
  each get a tint *and* a text cue, removed clips render as dashed ghosts at
  their old position, moved clips get a link from old to new. Triggered by
  comparing any two commits/branches or against the working copy
- **Export menu**: four real interchange formats (otio / fcpxml / edl /
  cutroom.json), each entry naming the tools that open it and what it loses
- **Persistence (project metadata)**: history (op log + undo cursor),
  commits (with parents), branches, HEAD/detached state and asset metadata
  persist to IndexedDB. The serialization core (`lib/persistence/project.ts`)
  is pure — no browser globals — with an explicit schema version; unknown
  versions are rejected with a clear error. Validation *replays* the op log
  through the engine's own reducer rather than re-implementing the rules,
  and rejects commits whose parents are missing. Round-trip tests cover a
  history with a redo tail, merge commits with two parents, detached HEAD,
  several branches and assets. Saves are debounced (700ms) after changes;
  the status bar shows saved / saving / unsaved. A corrupt or unreadable
  store is a *recoverable* failure: the raw text is kept, offered for
  export, with a reset — the app never crashes on load. If IndexedDB is
  unavailable or a write fails, the app falls back to memory and says so
  in the status bar rather than failing silently. Ctrl+K → "Reset project"
  (with a confirm). Storage-layer tests run against `fake-indexeddb`.
- **Media persistence**: uploaded files are stored in OPFS (Origin Private
  File System) keyed by their sha256 asset id, so a clip still plays after a
  refresh instead of falling into "not local yet". `navigator.storage.
  estimate()` is checked before writing and a file that does not fit is
  refused with a message saying how much room is left. Where OPFS is
  unavailable the app keeps the session-blob-URL behaviour and says so in
  the status bar. Deleting a clip deletes the file *only* when nothing
  references the asset any more — the rule is a pure function
  (`lib/media/references.ts`): a clip in the working timeline, or a clip
  in any commit's snapshot, is a reference; an asset sitting in the
  registry with no clip using it is not.
- **Lint gate**: `lintDelta` wired into the UI in three places —
  the compare view ("introduces N problems, resolves M"), the merge view
  (delta of the merged result against the current timeline, shown *before*
  the merge is committed, with an explicit "commit it anyway" confirmation
  when it introduces problems — it warns, it does not block), and the
  commit panel (delta against the parent commit).
- UI language: charcoal/olive surfaces, pale chartreuse accent, monospace
  transcript and timecode, keyboard-first.
  Demo seeders and the placeholder "agent" panel were removed as fake UI —
  nothing in the product is a mock.
- Perf harness pages: `perf.html` (engine ops in a browser JS runtime only)
  and `headed.html` (real Timeline + Player: 30-click scrub sweep on the real
  lane, boundary-stall capture, `?clip=long` memory run with heap before/after).
  Engine bench medians in PERF.md; every player number pending headed runs
- 255 web tests green; engine/web `tsc` clean, `vite build` succeeds.
  Total 391 tests in 46 files across the workspace.
- **Untested by unit tests (browser-only):** the OPFS calls themselves
  (getDirectory, createWritable, readMediaUrl). jsdom does not implement
  OPFS and `fake-indexeddb` only covers IndexedDB, so those paths are
  exercised by `scripts/verify-editor.mjs` in real headless Google Chrome:
  upload a file, refresh without interaction, confirm decoded frames and
  advancing playback. The reference-counting rule that decides whether a file may be
  deleted *is* unit-tested.
- **Not wired to any UI:** `lib/commands.ts` — the fixed-grammar command
  parser (`split at 2s`, `close gaps`, `goto 1:30`, …) with 8 passing
  tests. The prompt bar that used it was removed as UI that didn't earn
  its place; the parser is kept as tested core for a future agent bar,
  but nothing in the product calls it today. `closeGaps` itself is live
  (Ctrl+K → "Close gaps").

## Known issues (match reality, not older notes)

- **Selected sidebar visibility on 2026-10-25.** The subdued shadcn row
  was too hard to identify. The active destination now has a stronger neutral
  fill, inset outline, bold white label and trailing checkmark. Colour stripe
  remains removed. One new test checks that only the active item has a marker;
  live navigation checks that the marker follows selection. Updated screenshot:
  `.gstack/shadcn-sidebar/sidebar.png`. Typecheck and production build pass.

- **Sidebar menu correction on 2026-10-25.** User rejected the rail's pill,
  coloured icon and left stripe. ActivityBar now uses the fixed-sidebar menu
  subset of shadcn's composition (`SidebarMenu`, `SidebarMenuItem`,
  `SidebarMenuButton`), with 32px neutral rows, a workspace group, an export
  separator and bottom settings. Header export is preserved; sidebar export
  uses the same menu-button primitive. Three added regressions cover menu
  semantics, disabled/current states and both export triggers. Live Chrome
  checks navigation, neutral active styles, no stripe, export JSON download
  and laptop layout: `.gstack/verify-sidebar.mjs`. Screenshots:
  `.gstack/shadcn-sidebar/`. Web typecheck and production build pass.

- **Neutral dark correction on 2026-10-25.** User identified the navy tint
  in the first dark palette. All chrome, panels, inputs, lanes, borders,
  selections, ordinary text and scrollbars now use neutral grayscale.
  Accent/status colours remain. Command and export hovers use shared raised
  surface tokens. A new palette regression rejects tinted surface/text
  values; the browser dark check now asserts achromatic computed backgrounds
  in addition to luminance and contrast. Desktop/laptop screenshots are in
  `.gstack/neutral-dark/`; menus, graph, settings, commands and playback pass
  `.gstack/verify-dark-ui.mjs`.

- **Dark editor on 2026-10-25.** User requested a dark UI. The editorial
  workspace now uses charcoal panels, darker inset inputs, soft blue accents,
  brighter text, visible panel borders, larger media labels and numeric fields,
  and a shorter header. Timeline lanes, verification, graph/HEAD, menus,
  settings, command palette, scrollbars and native form controls follow the
  same dark palette. Graph colours are lighter for dark surfaces. Primary
  action labels use dark ink on blue for contrast. Two palette tests verify
  at least 4.5:1 contrast for normal and diagnostic text and primary labels;
  four component checks retain button/input/verification/review semantics.
  Browser checks in `.gstack/verify-dark-ui.mjs` assert actual computed
  surface luminance and text contrast, playback, menu/graph/verification/
  settings/command rendering and laptop bounds; screenshots and colour
  readings are in `.gstack/dark-editorial/`. Functional feature regression
  evidence is in `.gstack/dark-editorial-features-final/`.
  Subsequent user feedback requested standard components and quieter tabs.
  Installed `@radix-ui/react-tabs`; added shadcn-composed `ui/tabs.tsx` and
  migrated media, inspector, versions, editor and review tabs. History/Graph
  uses a compact segmented control; other tabs use neutral underlines.
  Arrow/Home/End navigation, selected panel rendering and ARIA relationships
  pass the live `.gstack/verify-tabs.mjs` check and two component regressions.
  Theme tokens now use `@theme static`: Tailwind previously omitted the
  warning variable while a utility still inlined its literal value, causing
  variable-based inline colours to inherit. Computed warning token/utility
  equality is checked by `scripts/verify-editor.mjs`.
  The complete playback/restore/cut/split/undo/layout/merge/commit flow passes
  in `.gstack/dark-regression-complete/`; media tab sizing leaves room for
  grid/list controls at desktop and laptop widths. Typecheck and production
  build pass with the Radix dependency.

- **Branch graph correction on 2026-10-25.** Lane assignment now anchors
  main rather than the checked-out branch, so feature commits fork visibly
  even when main has no newer work. Checkout keeps geometry unchanged.
  Shared tips share a dot; second-parent history retains a side lane after
  its branch name is deleted. Graph nodes/edges use consistent lane colours,
  current branch labels show HEAD, and rows fit within the sidebar. Four
  added regressions cover deleted branch pointers, fallback lane stability,
  rendered forks/HEAD and uninitialized state; the existing current-feature
  regression now requires separate main/feature lanes and stable checkout.
  Isolated Chrome reproduction matches main/s/twovideos from the reported
  screenshot: `.gstack/verify-branch-graph.mjs`, screenshot
  `.gstack/branch-graph-fixed.png`. No changes to saved user projects.

- **Approved design A implemented on 2026-10-25.** This supersedes the
  earlier studio layouts below: white/silver panels, cobalt controls,
  vertical activity rail, three-column contact sheet, black program monitor,
  Clip/Sequence/Project inspector, version rail and full-width timeline.
  New panel persistence IDs are `editorial-workspace` / `editorial-monitors`.
  Functional additions: footage/graphics/sequences browsing, filename/ID/tag
  search, grid/list, editable tags, image/audio/video import, position X/Y,
  linked or independent scale, rotation/reset, numeric start/in/out trim,
  volume, track assignment, clip dragging, add video track, hide/mute/lock,
  zoom slider/fit, preview zoom/fullscreen, rename project and frame rate.
  New-version creation preserves uncommitted edits; branch switching guards
  clip and metadata changes. Track flags persist locally in localStorage;
  creative transforms, added tracks and project settings are engine ops.
  Engine merge handles semantic transform defaults, project conflicts,
  new tracks/assets and three-way tags (independent additions and removals).
  Native JSON preserves all fields; OTIO stores transforms as Cutroom
  metadata. EDL/FCPXML omit visual transforms. Preview uses native media
  layers and CSS, with later video tracks above earlier ones; exports are
  timeline files, never an encoded video. No transitions or waveforms added.
  `scripts/verify-editorial.mjs` passed search/tags, transforms/volume,
  hide/mute/lock, trim/drag/zoom, graphics, fullscreen, settings, version
  creation, native download and refresh recovery with actual demo media.
  Evidence: `.gstack/editorial-features/`. The original upload/restore,
  cut playback, split/undo/redo, laptop geometry, merge/resolve/commit and
  restore checks passed in `.gstack/editorial-regression/`. Layered video,
  independent audio/image playback and a 50ms seek were browser-verified
  with `.gstack/layered-playback-small-seek-check.mjs`. Final desktop/laptop
  screenshots with four real Sintel excerpts: `.gstack/editorial-final/`.

- **Studio redesign on 2026-10-25 supersedes the layout polish below.**
  After feedback that the first pass still resembled a code editor, the
  workspace now uses a media browser, program monitor and properties row
  above a full-width sequence. The old large Issues pane is a collapsible
  Review drawer. New `studio-workspace` / `studio-monitors` persistence
  IDs prevent old proportions from forcing the old shape; previous
  localStorage entries are preserved. Two throwaway compositions were
  compared in `.gstack/studio-prototypes/`. Media tiles extract actual
  JPEG frames at up to 320×180. A shared cache holds at most 64 ready
  images; mounted tiles retain their own frame so cache eviction does not
  blank them. Decoder probes clean up after success, failure, abort and a
  10-second timeout. Timeline clips reuse ready posters without starting
  additional decoders. Strips repeat one representative source frame,
  not frame-by-frame thumbnails. No waveform analysis or fake waveforms
  were added. Inspector groups actual timing, source and audio values;
  split availability updates with the playhead. Screenshots with four
  real Sintel trailer excerpts are in `.gstack/studio-final/`; these are
  isolated QA fixtures, not seeded product state. Functional workflow and
  geometry checks are in `.gstack/studio-workflow-final/`. The cache
  eviction browser regression is `.gstack/poster-eviction-check.mjs`.

- **Editor UI polish on 2026-10-25.** Preview sizing now fits the full
  video frame inside the resizable panel instead of cropping its lower
  portion. New default panel proportions give preview more space and
  reduce unused bottom-panel space; existing saved layouts still win.
  Version controls are stacked with explicit field names and readable
  history rows so the sidebar no longer scrolls horizontally. Media has a
  named library, import action in its empty state, and duration/size rows.
  Dark surfaces, text contrast, focus outlines and the orange selected
  rail state are updated. Verified at 1440×900 and 1100×720 with browser
  geometry assertions and screenshots in `.gstack/ui-after-layout/` and
  `.gstack/ui-workflow-final/`. The full upload, playback, refresh,
  cut switch, split/undo/redo and merge-through-commit flow still passes.
  Small-phone layouts and touch workflows are not covered by this pass.

- **Media and merge repairs verified on 2026-10-25.** Upload probing had
  revoked the URL later registered for playback; the upload pipeline now
  retains accepted URLs and revokes rejected ones. It snapshots the input
  selection before asynchronous work so resetting a live file picker does
  not drop subsequent files. The asset URL registry is reactive so the
  player notices asynchronously restored OPFS media. Playback initializes
  its clock from the first animation frame, avoiding a negative first
  delta from mixing `performance.now()` and frame timestamps. Merge
  headings name the checked-out destination instead of repeating the
  source. Browser verification covers original MP4 upload/playback,
  reload/decode/playback without a preceding edit, two-file selection,
  playback across a cut using short excerpts, split/undo/redo, divergent
  splits, overlap resolution, lint delta, merge commit on main, and merge
  plus media restoration. These are functional checks, not representative
  performance measurements or audio-quality assessment. Evidence is in
  `.gstack/media-fix-verification-4/`; the repeatable runner is
  `scripts/verify-editor.mjs`. Existing uncommitted timeline/merge work was
  preserved; these repairs are not committed.

- **Old preload was a no-op — retired, fix shipped unmeasured.** The first
  player warmed a separate hidden element nothing ever consumed (no
  `readyState`/`loadeddata`/`seeked` check anywhere on the swap path). The
  double-buffered rewrite replaces it; swap policy is unit-tested, but no
  headed measurement exists yet, so no stall claim is made.
- **1503 ms boundary swap stall — retired, headed re-measure pending.**
  Real measurement, wrong setup (headless Chrome, software decode, cold
  9.2 MB fetch, src-assign → `playing` timer). Superseded, not cited
  anywhere except PERF.md's retired section.
- **33 ms scrub click-to-paint — retired.** Measured against a stand-in
  div, never the real timeline. The synthetic lane is deleted; scrub is
  measured against `[data-timeline-lane]` in `headed.html`, pending runs.
- **Every headed number stays "pending"** until real headed-Chrome runs are
  pasted in. No display is available in this environment, so none are quoted.
- **Export formats lose things, by design of the formats.** FCPXML drops
  gaps between clips on a track (Final Cut has no gaps); EDL drops asset
  links, effects and per-clip metadata (it is a cut list, not a project);
  only `.cutroom.json` round-trips everything. The export menu says this
  on each entry rather than hiding it.
- **Export writes a timeline, not a video.** There is no renderer: no
  canvas/WebGL compositor, no encoder. A real MP4/WebM render is not
  built. Do not describe the export menu as "export the video".
- **The exported files have not been opened in a real NLE.** EDL and FCPXML
  are verified as well-formed and structurally correct (FCPXML is parsed
  with a real XML parser; EDL event/track mapping is unit-tested), but
  "opens in Premiere" is untested here — no display, no NLE. Say
  "interchange format with round-trip tests", not "works in Resolve".
- **Frame rate is an integer project setting.** It defaults to 30fps;
  fractional rates such as 23.976 are not supported.
- **The commit graph draws structure, not media.** A branch with no
  commits of its own has no lane (correctly — there is no fork to draw),
  so a graph of branch pointers alone can look like a single line.
- **The fixed-grammar command parser is not reachable from the UI.** The
  prompt bar was removed; `lib/commands.ts` survives only as tested core.

**Not built:**
- `apps/server` — empty. Sync, commits, blob store.
- Version Control presentation layer: branches, commits, checkout,
  conflict-resolution UI ("resolve without friction" half of Cardboard's
  question) — branch/commit/checkout/merge UI DONE; colour-coded diff view
  DONE as tints + ghosts + moved links; visual commit graph DONE;
  ghost-clip *conflict* rendering on the timeline still open.
- Verification (linter): DONE in the engine (`lint.ts`); diagnostics
  rendering DONE (clip markers + panel with click-to-jump).
- Effect ops (`applyFilter`, `setCaption`, ...): discussed, not built.
  Design agreed: content edits as parameterized ops so the agent's output
  flows through the existing log/diff/merge machinery. Rendering them needs
  the player to exist first.
- Video rendering (MP4/WebM): no compositor, no encoder. Exports are
  timelines, not rendered video.

## What the engine does NOT do (explicit non-goals)

- No UI, no playback, no disk persistence, no user sync.
- Tracks timeline *structure*, not media *content*. Cannot see inside
  frames; pixel edits, filters, grades are invisible unless expressed as
  parameterized ops (not yet built). No pixel-level diff/merge — by design,
  never planned.
- `history.ts` is a linear undo log, not version control. Branches,
  commits, and merge history exist only in the web `vcs.ts` layer
  (in-memory, not persisted); the engine itself has no history graph.

## Remaining plan

- [x] Verification linter in the engine (`lint()` + rules + tests) — DONE
      (`598af3d`); UI rendering of diagnostics DONE (markers + panel)
- [ ] Effect ops in the engine (agent-edit representation) — DEFERRED until
      the player exists to render them; structural ops already work
- [x] Timeline UI + player: render clips, scrub, split/trim/delete via the
      engine, swap `<video>` src at clip boundaries, preload next clip — DONE
      (`ae853b2`); double-buffered swap shipped later (`79c86c9`)
- [ ] Web Worker for thumbnails/waveform (keep scrubbing smooth) — DEFERRED,
      not needed at prototype scale
- [x] Commit/branch UI + clip-level diff view on the timeline — DONE
      (`79832e1` branches/commit/checkout/merge; `d85bfea` colour-coded diff
      view with ghosts and moved links)
- [x] Commit checkout (detached HEAD) + watch that snapshot — DONE
      (`9c6de39`); commit blocked while detached, branches fork off a viewed
      commit
- [x] Conflict UI: field conflicts and overlaps resolvable — DONE as a
      resolution list with per-conflict buttons (`79832e1`); the list moves
      into the Merge editor tab (`e17ec30`)
- [ ] Ghost-clip *conflict* rendering on the timeline: conflicts resolve
      from a list today, not in place where the clash is
- [ ] Yjs live collab between two tabs, presence (cursor, playhead, author
      color) — DEFERRED, needs `apps/server` first; identity plumbing is in
- [x] Content-addressed asset upload + "not local yet" state — DONE
      (`79832e1` upload + sha256; `7f32c02` media persisted in OPFS so
      clips survive a refresh)
- [ ] Proxy generation + cross-machine asset sync — OPEN: no proxy
      transcoding, no server, no blob store
- [x] Engine perf numbers: medians of 3 back-to-back `vitest bench` runs
      (2026-10-14) — applyOp 0.002 ms (20 clips) / 1.17 ms (1,000 clips),
      diff 0.012 / 0.75 ms, merge 0.08 (20) / 5.75 clean / 5.32 conflict
      @1000 (re-measured after a bench fix; batch ran hot, see PERF.md),
      lint 0.013 / 0.58 ms. Full per-run table in PERF.md
- [ ] Player perf numbers (boundary-swap stall, scrub click-to-paint) and
      memory footprint on a genuine 5–10 min 720p timeline — PENDING headed
      runs; the 1503 ms stall and 33 ms scrub figures are retired (see
      PERF.md for why). The harness and the media script are ready
- [x] Lint gate: `lintDelta` with stable diagnostic identity, wired into
      the compare view, the merge view (warn + explicit confirm, never
      blocks) and the commit panel — DONE (`e728c54`)
- [x] Persistence of project metadata to IndexedDB, with a recoverable
      corrupt-store path, a memory fallback and Ctrl+K "Reset project" —
      DONE (`5f20deb`)
- [x] Persistence of media in OPFS, quota-checked, with reference-counted
      deletion — DONE (`7f32c02`)
- [ ] AI layer (deferred, needs an API key): narration of `diff()` output and
      merge conflicts into plain English; lint fix suggestions. Engine stays
      the source of truth — the model narrates or proposes ops, never mutates
      the timeline directly
- [x] OTIO (`.otio`) export: the workflow-interchange bridge so a merged
      timeline can be finished in Premiere/Resolve. Serialiser + round-trip
      tests, no new UI
- [x] Multiple export formats — DONE (`33542f3`): otio, fcpxml, edl
      (CMX3600) and a lossless `.cutroom.json`, all engine-side pure
      functions behind an `EXPORT_FORMATS` registry, with an export menu
      that names the tools each format opens in and what it loses
- [x] Visual commit graph so non-engineers can read the history — DONE
      (`fe37b64`, lanes fixed in `a4c8fb9`): branch-based lanes, per-branch
      line colours, click to check out
- [x] VS Code-style shell: activity rail, resizable persisted panels, editor
      tabs (Timeline/Diff/Merge), bottom panel (Issues/Activity), status bar
      — DONE (`dc94ccb` → `e17ec30`)
- [ ] Ghost-clip *conflict* rendering on the timeline: conflicts resolve
      from a list today, not in place where the clash is
- [ ] README with numbers, CRDT/branch tradeoff, deliberate cuts
      (multi-track, effects rendering, auth) — README.md written; numbers
      need the headed run to be final
- [ ] Demo video

## Application connection

- Resume: tailored and submitted, leads with MCP Foundry and VoiceScope, no
  fabricated media experience.
- Application video: the plan was unscripted clips fed into Cardboard's own
  AI editor — "an agent makes real edits" as the format itself. **Whether
  that video was recorded is not verifiable from this repo**; treat its
  status as unknown rather than done. The follow-up this repo is meant to
  support would show the workflow layer: branch, merge, resolve, verify.

## Persistence limits (what "it saves" does and does not mean)

- **One browser, one project.** Everything lives in the browser's
  IndexedDB and OPFS. There is no server, no sync and no sharing — two
  browsers are two unrelated projects. Clearing site data erases the
  project.
- **Media size depends on the browser's quota.** `navigator.storage.
  estimate()` is checked before writing; a file that does not fit is
  refused with the room left. The quota is the browser's, not ours.
- **Nothing is encrypted.** Project metadata and media are stored in the
  browser's private storage in plain form. Fine for a local prototype;
  not a security boundary.
- **No export of the raw store.** `.cutroom.json` exports the timeline,
  not the op log or the media bytes. The only way out of the browser is
  the timeline formats.

## Ground rules

- **No overclaiming.** Claims must be checkable against this repo and its
  test suite.
- **Don't fake video depth that doesn't exist.** Honest framing: strong
  systems/logic fundamentals applied to a media domain for the first time,
  gap stated plainly.
- Unilateral engine decisions made without discussion (open to revision):
  6th op `setVolume`; throw-on-invalid; delete-cascades-to-children;
  field/overlap/deleteModify conflict taxonomy.
- **Update CONTEXT.md after every batch.** It is the handover document: if
  it drifts from the code, the next session inherits a lie. Numbers,
  file names and test counts in here must match what the commands
  actually print.

## Environment

- Node v26, pnpm 11. `pnpm install` wrapper currently trips on esbuild
  build-approval (`ERR_PNPM_IGNORED_BUILDS`); run binaries directly from
  `node_modules/.bin/` (vitest, tsc) until fixed.
- `/mnt/nvme0n1p10/cardboard` also contains unrelated files NOT part of
  this project: `*.mp4` files, `Shivam_Chavan_Resume_AiPrise.pdf`,
  `bridge/` (Python script). Do not stage these into git.
