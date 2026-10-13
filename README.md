# Cutroom

A browser video editor prototype built around two of Cardboard's named hard
problems: **version control for video** and **verification (a linter for
video)**.

Not an NLE. The timeline UI exists to demonstrate the workflows — branching,
merging, conflict resolution, attribution, and automated checks — not to
compete with Resolve. Deep editing stays in real tools: exports go to
OpenTimelineIO (`.otio`), which Premiere, Resolve, Blender, and Kdenlive all
read.

```
You are here: the workflow layer. Branch, merge, verify, attribute — then
finish in a real editor.
```

## Why

Cardboard's [hard problems doc](https://www.usecardboard.com/hard-problems)
poses the two questions this project answers with working, tested code:

> "What does a diff even look like for a timeline? How do you present a
> conflict in a way an editor can resolve without friction?"

> "There's no linter for video. We have to build one."

Built by someone with strong systems/LLM background and no prior browser
media experience, deliberately closing part of that gap in public. The
engine is pure TypeScript, fully tested — the interesting parts are logic,
not pixels.

## Architecture

```
Browser                                    Server
┌──────────────────────────────────┐        ┌──────────────────────┐
│ UI (React)                        │        │ (not built yet)      │
│  timeline, player, merge/conflict │        │  y-websocket relay   │
│  diagnostics, activity feed, VCS  │        │  commit/branch API   │
│      │                            │        │  content-addressed   │
│ Store (Zustand) ── History ───────┼── Yjs ─┼──  blob store        │
│      │  (op log + cursor)         │        └──────────────────────┘
│ ENGINE (pure TS, no DOM, no React)│
│  model · ops · diff · merge · lint│
└──────────────────────────────────┘
```

- **`packages/engine`** — all timeline logic. No React, no DOM, no I/O.
- **`apps/web`** — the UI. Never calls the engine's reducer directly; every
  edit goes through the store, which is the single "local edit" call site.
- **`apps/server`** — empty. Live collab is the next major piece.

## How it works

### The timeline is a clip-ID-keyed map, not an array

In an array, "clip moved from index 2 to 5" and "clip deleted, similar clip
inserted" produce identical state. Keyed by stable identity, position is a
*field of the clip* (`start`), so a move diffs as a move. This one decision
is what makes diff and merge tractable.

### All state changes flow through one reducer

Six ops — `addClip`, `splitClip`, `trimClip`, `moveClip`, `deleteClip`,
`setVolume` — applied through a single `applyOp`, called from exactly the
local-edit path (store). Invalid ops throw loudly: a silently dropped op is
indistinguishable from a lost one three commits later.

Split produces deterministic child IDs from (parent, split point, side).
Two branches that split the same clip at the same frame converge on the
same IDs instead of manufacturing a conflict — covered by tests.

### Merge is two passes

Pass 1: per-clip, per-field 3-way merge against a common ancestor
(only-you-changed → take yours, both-changed-same → converged,
both-changed-different → field conflict).

Pass 2: geometric overlap sweep over the *merged result*. This pass is not
redundant: branch A trims clip 1 to end at 10s, branch B moves clip 2 to
start at 9s. No clip changed on both branches, so pass 1 reports zero
conflicts — yet the merged timeline has a collision. Only pass 2 catches it.
There is a test asserting pass 1 stays silent on exactly this case.

**Overlaps are never auto-resolved by shifting clips.** Retiming someone's
edit without asking is the one thing a video editor will not forgive.
Conflicts are surfaced for explicit resolution: pick a side, or remove a
clip. The merge UI cannot invent content the engine didn't produce.

### The linter

`lint(timeline) → diagnostics[]` — pure static analysis over timeline
structure. Nine rules across two severities:

| Rule | What it catches | Severity |
|---|---|---|
| `overlap` | two clips cover the same time on one track | error |
| `gap` | dead air between consecutive clips | warning |
| `missing-media` | clip references an unregistered asset | error |
| `flash-frame` | clip under ~3 frames | warning |
| `trim-past-source` | clip reads beyond its file's end | error |
| `zero-length` | dead entry | error |
| `unused-asset` | synced weight doing nothing | warning |

Severity is assigned by the caller, so a proxy-first workflow can downgrade
`missing-media` to a warning. Rules plug into a `defineRule` harness; a new
rule is ten lines plus an id.

This is layer 1 of Cardboard's verification problem — the deterministic,
model-free half. Cardboard's full vision ("does the edit *look* good,
matches the brand, holds a story arc") needs models and engagement data;
that is out of scope here and not claimed.

### Version control, git-shaped

Commits snapshot whole timelines (they're small JSON). Branches are named
pointers. Merges find the nearest common ancestor, run the two-pass merge,
and record two parents. Resolution happens per conflict, explicitly:
field → keep ours / take theirs; delete-vs-edit → keep / remove; overlap →
keep one side. Committing a merge requires a clean result and a message.
Assets ride in the commit's history base, so undo/redo never breaks.

### Attribution is derived, never stored

Every op carries an author. Blame ("last edited by X") and the activity
feed ("Bob split a at +2.0s", with undone entries struck through) are
derived from the op log by formatting it, so they cannot disagree with
what was applied.

### OTIO export

`toOTIO()` serializes a timeline to the `.otio` JSON that Premiere, Resolve,
Blender, and Kdenlive read. Round-trip is lossless for gap-free timelines;
import drops gaps (no gap representation in our model) but reconstructs
every clip's position and timing exactly. Content-addressed asset ids and
per-clip volume ride in `metadata.cutroom` rather than being forced into
fields that mean something else.

**This is the point of the whole layer:** decide, branch, merge, and verify
here — then finish anywhere.

## Deliberate cuts

- **No canvas/WebGL compositing.** Playback swaps `<video>` sources at clip
  boundaries. A real compositor is a multi-week render pipeline.
- **No viewport virtualization.** Fine at prototype scale; noted, not built.
- **No pixel-level diff or merge.** Content edits become parameterized ops
  or they don't exist. (Actively deferred, not claimed.)
- **No server, no auth, no sync.** Live collab (Yjs) and the blob store are
  the next major piece.
- **No Rust/WASM.** The memory bottleneck is decoded media (native speed in
  the browser); the timeline engine is small JSON. Rust enters for per-pixel
  compute, which this build deliberately avoids.

## Measured performance

Real numbers from this repository, reproducible: `vitest bench` (engine)
and the built-in headless harness at `/perf.html`
(`node scripts/perf-drive.mjs`, drives system Chrome over CDP).

### Engine (pure TypeScript, Node 26, mean per call)

| op | 20 clips | 1,000 clips |
|---|---|---|
| `applyOp` | 0.0035 ms | 0.96 ms |
| `diff` | 0.026 ms | 1.70 ms |
| `merge` (clean) | — | 3.91 ms |
| `lint` | 0.026 ms | 0.95 ms |

### Browser (headless Chrome 155, real components)

| measurement | mean | p99 |
|---|---|---|
| scrub click → first paint | 33.2 ms | 33.6 ms |
| applyOp @ 20 clips | 0.005 ms | 0.10 ms |
| applyOp @ 1,000 clips | 1.15 ms | 2.50 ms |

33 ms is two 60 Hz frames: one for the React commit, one for paint. The
engine is never the bottleneck — scrub latency is dominated by the frame
budget, not timeline logic. The player logs every boundary-swap stall
(`[player] boundary swap stall: Nms` in the console) so boundary handoffs
can be measured rather than assumed. Measured on a 2.4 MB → 9.2 MB cut on
this machine: **1503 ms** of stall before the second clip's audio starts.
The hidden-`<video>` preload of the next element did not hide that: the
file still has to arrive and decode before it can play. Honest conclusion,
and the spec's real mitigation: proxy-first sync — send a low-resolution
preview, let the edit stay smooth, and upgrade in place. That mitigation
is written down, not built yet (see CONTEXT.md).

**Known limitation:** numbers come from a 5.7 GB machine with small test
files. Memory footprint and scrub behavior on 5–10 minute 720p timelines
are measured, not assumed — see CONTEXT.md's status for what is proven
vs. instrumented-but-unrun.

## Testing

```
packages/engine   66 tests   vitest run
apps/web          21 tests   vitest run      (store, timeScale, playback, vcs, op narration)
```

Merge and lint cases are adversarial: the overlap case a per-clip merge
misses, split convergence across branches, delete-vs-modify, concurrent
adds, asset bounds, malformed clips.

## Run it

```bash
pnpm install
pnpm --filter @cutroom/engine test      # 66 tests
pnpm --filter @cutroom/web test         # 21 tests
pnpm --filter @cutroom/web dev          # http://localhost:5173
```

Try, in order: **Add test clips** → Play (watch boundary handoffs in the
console) → select a clip, move the playhead, `S` to split → drag a clip
edge to trim → commit → **Branch** → edit → commit → switch back → edit
main → **Merge** → resolve a conflict → **Export .otio**.

## CRDT vs. explicit merge — the tradeoff, stated plainly

Live collab inside a branch will be CRDT-style (Yjs): concurrent edits
auto-merge because both users are moving toward the same cut together.
Merging *across* branches is explicit and git-style. The boundary is
deliberate: auto-merge is right when two people share one intent, wrong
when a branch is a hypothesis that might lose. This is a real tension,
not a solved problem, and the code doesn't pretend otherwise.
