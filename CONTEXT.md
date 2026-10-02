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
                    │      │                         │                   │
                    │  Sync layer (Yjs)          Media layer             │
                    │   live doc per branch      OPFS cache, worker      │
                    │      │                     thumbnails, proxy/full  │
                    └──────┼─────────────────────────┼───────────────────┘
                           │ WebSocket               │ HTTP range requests
                    ┌──────┴─────────────────────────┴───────────────────┐
                    │  Server (Node + TS)                                │
                    │   y-websocket relay · commit/branch API (SQLite)   │
                    │   blob store keyed by hash · ffmpeg proxy job      │
                    └────────────────────────────────────────────────────┘
```

**Repo layout:**
```
/packages/engine    pure TS: model, ops, diff, merge, tests (Vitest)
/apps/web           React + Vite — timeline, player, diff/conflict UI (EMPTY)
/apps/server        Node: y-websocket, REST, SQLite, blob store (EMPTY)
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

**Built, tested, committed (`195c406`):**
- `packages/engine/src/model.ts` — timeline data model
- `packages/engine/src/ops.ts` — Op types + single `applyOp` reducer,
  deterministic split IDs, split/delete composition
- `packages/engine/src/history.ts` — op log + cursor undo/redo, blame
  derived from the log
- `packages/engine/src/diff.ts` — clip-level diff
  (added/removed/moved/trimmed/edited)
- `packages/engine/src/merge.ts` — 3-way field merge + overlap pass,
  `resolveField`, `overlappingPairs`
- 56 Vitest tests green (ops.test 16 incl. 4 model tests, history.test
  11, merge.test 13, lint.test 16), `tsc --noEmit` clean
- `packages/engine/src/lint.ts` — Verification linter: `Diagnostic`,
  `Rule`, `defineRule` harness, `lint()` with include/exclude/severity
  overrides, 7 built-in rules (overlap, gap, missing-media, flash-frame,
  trim-past-source, zero-length, unused-asset). Deliberate swap: `clipping`
  dropped because `setVolume` already rejects out-of-range values — a rule
  that can never fire is decoration. Severity is caller-assigned, so
  proxy-first workflows can downgrade missing-media to a warning
- Tests cover: split determinism across branches, clean merge, field
  conflict, the overlap case a naive merge misses, no auto-shift,
  delete-vs-modify, concurrent-add conflict, asset-bounds rejection,
  malformed-clip rejection

**Not built:**
- `apps/web` — empty. Timeline UI, player, diff/conflict views.
- `apps/server` — empty. Sync, commits, blob store.
- Version Control presentation layer: branches, commits, checkout,
  conflict-resolution UI ("resolve without friction" half of Cardboard's
  question).
- Verification (linter): DONE in the engine (`lint.ts`). Remaining is the
  UI rendering of diagnostics (squiggles/markers on the timeline).
- Effect ops (`applyFilter`, `setCaption`, ...): discussed, not built.
  Design agreed: content edits as parameterized ops so the agent's output
  flows through the existing log/diff/merge machinery. Rendering them needs
  the player to exist first.

## What the engine does NOT do (explicit non-goals)

- No UI, no playback, no disk persistence, no user sync.
- Tracks timeline *structure*, not media *content*. Cannot see inside
  frames; pixel edits, filters, grades are invisible unless expressed as
  parameterized ops (not yet built). No pixel-level diff/merge — by design,
  never planned.
- `history.ts` is a linear undo log, not version control. No branches,
  commits, or history graph exist yet.

## Remaining plan

- [ ] Effect ops in the engine (agent-edit representation)
- [ ] Verification linter in the engine (`lint()` + rules + tests)
- [ ] Timeline UI + player: render clips, scrub, split/trim/delete via the
      engine, swap `<video>` src at clip boundaries, preload next clip
- [ ] Web Worker for thumbnails/waveform (keep scrubbing smooth)
- [ ] Commit/branch UI + clip-level diff view on the timeline
- [ ] Conflict UI: field conflicts and overlaps as resolvable ghost clips
- [ ] Yjs live collab between two tabs, presence (cursor, playhead, author color)
- [ ] Content-addressed asset upload + proxy-first sync + "not local yet"
- [ ] Real perf numbers: scrub/sync latency, memory on 5–10 min 720p on the
      5.7GB dev machine
- [ ] README with numbers, CRDT/branch tradeoff, deliberate cuts
      (multi-track, effects rendering, auth)
- [ ] Demo video

## Application connection

- Resume: tailored and submitted, leads with MCP Foundry and VoiceScope, no
  fabricated media experience.
- Application video: unscripted clips fed into Cardboard's own AI editor —
  demonstrating "an agent makes real edits" as the format itself. Video
  says the prototype is in progress; this repo is the follow-up once the
  player + collab work.

## Ground rules

- **No overclaiming.** Claims must be checkable against this repo and its
  test suite.
- **Don't fake video depth that doesn't exist.** Honest framing: strong
  systems/logic fundamentals applied to a media domain for the first time,
  gap stated plainly.
- Unilateral engine decisions made without discussion (open to revision):
  6th op `setVolume`; throw-on-invalid; delete-cascades-to-children;
  field/overlap/deleteModify conflict taxonomy.

## Environment

- Node v26, pnpm 11. `pnpm install` wrapper currently trips on esbuild
  build-approval (`ERR_PNPM_IGNORED_BUILDS`); run binaries directly from
  `node_modules/.bin/` (vitest, tsc) until fixed.
- `/mnt/nvme0n1p10/cardboard` also contains unrelated files NOT part of
  this project: `*.mp4` files, `Shivam_Chavan_Resume_AiPrise.pdf`,
  `bridge/` (Python script). Do not stage these into git.
