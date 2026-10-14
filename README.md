# Cutroom

A browser-based video editor prototype built to answer two of Cardboard's
own hard problems with working code instead of claims:

1. **Version Control** — "Code has git. Video has nothing."
2. **Verification** — "There's no linter for video. We have to build one."

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
- **Web UI** (`apps/web`): timeline rendering, `<video>` player with
  double-buffered boundary swaps, split/trim/delete, blame dots, activity
  feed, video upload (sha256 asset ids), and a git workflow — commits,
  branches, checkout, merge with per-conflict resolution.
- **OTIO export**: one click downloads `.otio` for Premiere / Resolve /
  Blender (serializer + round-trip tests; open it in a real NLE to verify).

## Numbers

Engine ops, measured on the dev machine (`vitest bench`, see PERF.md):

| op | 20 clips | 1,000 clips |
|---|---|---|
| applyOp | 0.002 ms | 1.17 ms |
| diff | 0.012 ms | 0.75 ms |
| merge (clean / conflict) | — | 2.07 / 3.09 ms |
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

- **Multi-track compositing, transitions, effects rendering** — the player
  swaps `<video>` sources at boundaries; no canvas/WebGL pipeline.
- **Pixel-level diff/merge** — by design, never planned. The engine tracks
  timeline structure; content edits must arrive as parameterized ops.
- **Auth** — localStorage guest identity; presence-ready, login-free.
- **Rust/WASM** — the engine is small JSON (see table); decoded media is
  the memory cost and browsers already decode natively. Revisit for pixel
  pipelines, not for this layer.
- **Yjs live collab + server** — architecture sketched in CONTEXT.md,
  not built.

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

87 tests green (66 engine + 21 web), `tsc --noEmit` clean. Honest
accounting of what's proven vs pending lives in CONTEXT.md, CARDBOARD-KB.md
(research notes), and PERF.md.
