# Cutroom perf notes

Measured numbers only. Anything not measured is labeled pending or retired —
see the bottom section before citing a number from an old commit message.

## Measured editor optimizations, 2026-10-25

The comparison baseline is `c2209dfcf7f7a83dbdce9d4785ffd7040ad70c99`.
The harness loads that revision's source independently from the working tree.
Measurements below use five alternating runs per side on Node v24.17.0,
with eight CPU cores and an initial load average of 1.18. These are local
measurements on synthetic timelines, not portable latency guarantees.

Reproduce the resolver and dispatch measurements from the repo root:

```bash
node scripts/measure-editor-performance.mjs --baseline c2209df \
  --clips 20,1000,10000 --ticks 120 --history 100,1000 \
  --output .gstack/performance-audit/comparison.json
```

The resolver test consumes every returned layer and checks clip IDs and
source offsets against an independent oracle. The dispatch test checks its
output against replay by the frozen baseline reducer. Both report errors
and work counts. No mismatches occurred.

| Workload | Original median, range in ms | Optimized median, range in ms |
| --- | --- | --- |
| Warm layer lookup, 20 clips across eight tracks | 0.0144, 0.0113 to 0.0169 | 0.0034, 0.0024 to 0.0045 |
| Warm layer lookup, 1,000 clips | 0.3764, 0.3606 to 0.4638 | 0.0042, 0.0040 to 0.0050 |
| Warm layer lookup, 10,000 clips | 35.1577, 33.2098 to 41.5150 | 0.0307, 0.0273 to 0.0491 |
| First lookup on a fresh 10,000-clip revision | 33.0482, 30.1510 to 35.6743 | 4.6822, 4.3107 to 5.5193 |
| Dispatch after 1,000 operations, 1,000 clips | 5.2688, 5.0678 to 6.6170 | 0.0734, 0.0423 to 0.1289 |

The web cache groups and orders clips once per immutable clips record and
calculates duration in the same pass. The separate CPU profile identifies
repeated `clipsOnTrack` work as the old resolver's main cost. Warm lookup
still scans each ordered track for the earliest active overlapping clip.
A first lookup includes index construction. At 20 clips, cold timing ranges
overlap, so no cold-start improvement is claimed there.

Dispatch now applies the new operation to the current immutable snapshot.
Undo, redo, restore and asset-base replacement retain canonical replay.
Timeline and Inspector both supply that current snapshot to `authorsByClip`,
which avoids another replay just to find surviving clip IDs.
The bare-dispatch timing excludes React, subscribers, restore and history
construction. Resolver timing excludes DOM layout and native video decoding.

### Browser work and recovery

The final production Chrome comparison applies 20 real inspector edits to
a project with 1,000 clips and 1,000 prior operations. Every run checks that
all 1,020 operations and the final transform were persisted. Five alternating
runs per side had no errors. Chrome's `ScriptDuration` measures main-thread
JavaScript across those edits, including store subscriptions, authorship,
React rendering, field handlers and scheduling persistence:

| Browser workload | Original median, range | Optimized median, range |
| --- | --- | --- |
| Main-thread JavaScript across 20 edits | 25,316 ms, 24,309 to 25,676 | 389 ms, 366 to 448 |
| OPFS URL restoration for 200 small files | 504.1 ms, 403.7 to 567.5 | 247.1 ms, 232.2 to 288.0 |

The inspector measurement caught a remaining full replay after the first
history change. Passing its current snapshot removed that cost. The Chrome
fixture references media metadata without decoding video during measurement.
Automation wall times include Playwright and two animation-frame waits and
are not used as a playback or input-latency claim.

The OPFS comparison uses actual Chrome file handles and verifies the bytes
behind every returned URL outside the timed interval. It excludes React,
byte verification and video decoding. Recovery uses four concurrent reads
and publishes one immutable URL-map update instead of 200 updates. For one
file, both sides measured 1.9 ms, with overlapping 1.8 to 2.6 ms ranges.
Missing files and rejected reads retain successful recoveries. Cancellation
stops queued work and revokes unpublished URLs without revoking live media.

In the 1,000-clip, eight-track fixture at 1440 by 900 pixels, the timeline
mounts 104 clips initially and 88 at the end instead of all 1,000. Full lane
geometry remains available to scroll. Selection, keyboard focus, pointer
capture and focused merge controls can pin offscreen elements until the
interaction ends. Ruler marks and merge/diff overlays use the same window.

Real-media browser checks separately cover decoding, advancing playback,
source handoff, refresh recovery, transforms, track controls, drag, trim,
merge resolution and saved edits. Those checks establish behavior, not
native playback FPS or decoder stall performance. The laptop geometry check
allows 1/64 CSS pixel rounding after observing a 0.0078125 CSS pixel difference
in a transformed frame's bounds. This is below a visible CSS pixel.

Raw local evidence is in `.gstack/performance-audit/`: `comparison.json`,
`lookup-baseline.cpuprofile`, `browser-edits-final.json`, `media-after.json`,
`final-tests.log`, and the final browser verification artifacts. The local
browser probes require Chrome and Playwright; their outputs are not included
in the Git repository. The repeatable pure comparison is in `scripts/`.

## Measured: engine ops (dev machine, Node, `vitest bench`)

`packages/engine/src/engine.bench.ts`. Medians of 3 back-to-back runs on
2026-10-14 (means per run; full per-run table below):

| op | 20 clips | 1,000 clips |
|---|---|---|
| applyOp | 0.002 ms | 1.17 ms |
| diff | 0.012 ms | 0.75 ms |
| merge (clean) | 0.08 ms | 5.75 ms |
| merge (field conflict) | — | 5.32 ms |
| lint | 0.013 ms | 0.58 ms |

The applyOp/diff/lint medians are from the 2026-10-14 batch; the merge
medians are from a second 2026-10-14 batch run after fixing the bench (see
below). Per-run means (ms):

Batch A (applyOp/diff/lint medians) — run 1 / run 2 / run 3:

| op | run 1 | run 2 | run 3 |
|---|---|---|---|
| applyOp @20 | 0.0017 | 0.0017 | 0.0017 |
| applyOp @1000 | 1.17 | 0.93 | 1.17 |
| diff @20 | 0.0122 | 0.0106 | 0.0118 |
| diff @1000 | 0.76 | 0.74 | 0.75 |
| lint @20 | 0.0131 | 0.0125 | 0.0133 |
| lint @1000 | 0.54 | 0.74 | 0.58 |

Batch B (merge, fixed bench) — run 1 / run 2 / run 3:

| op | run 1 | run 2 | run 3 |
|---|---|---|---|
| merge clean @20 | 0.0585 | 0.0816 | 0.0847 |
| merge clean @1000 | 4.97 | 5.75 | 6.56 |
| merge conflict @1000 | 5.16 | 5.32 | 5.82 |

On the 0.70 ms vs 2.14 ms applyOp@1000 spread from earlier runs: same file,
same clip counts, same ops — vitest bench does its own warmup and adaptive
iterations in all runs, so the setup is identical. The spread is noise, not
method: this box is shared, per-run rme on the 1000-clip benches is ±5–9%,
max samples spike to 10–38 ms (GC/contention), and one batch's own three
runs already spread 0.93→1.17 (26%). Batch B ran hotter across the board
(applyOp@1000 1.34–1.63, diff@1000 ~3.0–3.3 vs 0.74–0.76 in batch A) —
same code, heavier concurrent load. Merge medians are quoted from batch B
as measured; expect ±2x run-to-run on this box.

Bench fix (batch B): the field-conflict bench used to call one extra
`applyOps` trim *inside* the timed function, so the old conflict number
included ~1 ms of non-merge work. The setup is hoisted out now and only
`mergeTimelines` is timed; a 20-clip clean merge was added following the
same pattern as the other benches. Clip counts, warmup and iterations are
unchanged.

Reading: at prototype scale (tens of clips) every engine op is
sub-millisecond — the engine is not the bottleneck. At 1,000 clips the
costs are single-digit milliseconds, dominated by spreading the clips
record on each op (structural sharing keeps untouched clips identical by
reference, which is what lets the React selectors stay cheap). Re-run with
`./node_modules/.bin/vitest bench --run packages/engine/src/engine.bench.ts`
from the repo root.

## Pending: player numbers (need headed Chrome on a machine with a display)

The Player (`apps/web/src/components/Player.tsx`) is double-buffered: two
`<video>` elements, the hidden one warmed to `readyState >= 4` on inPoint
~1s before each boundary. Stall = boundary tick to the new element's first
`playing` event, logged as `(preload on)` / `(preload off)`.

Protocol (`apps/web/headed.html`, real Timeline + Player, real test media):

```
google-chrome --autoplay-policy=no-user-gesture-required \
  "http://localhost:5173/headed.html?auto=1"                # preload on
google-chrome --autoplay-policy=no-user-gesture-required \
  "http://localhost:5173/headed.html?auto=1&preload=off"    # preload off
```

Run each 3+ times, take the median of the `boundary swap stall` lines and
the `scrub click->paint (real lane)` line. Headed only — headless Chrome
decodes video in software and inflates every video timing (see Retired).

## Pending: long-clip memory + scrub (script ready, run pending)

`scripts/make-test-media.sh` generates the media (ffmpeg 6.1 verified
present on the dev machine; the script checks and refuses otherwise):

```sh
./scripts/make-test-media.sh 600   # 10 min 720p30 + sine tone, ~100-200 MB
```

Output lands at `apps/web/public/test-long.mp4`, which is gitignored
(`*.mp4`) and must stay uncommitted. Then, headed:

```sh
google-chrome --autoplay-policy=no-user-gesture-required \
  "http://localhost:5173/headed.html?auto=1&clip=long"
```

The harness probes the real duration, seeds one full-length clip, records
JS heap before load / after load / after ~2 min of scrubbing (60 real-lane
clicks across the clip) + 60 s of playback, and prints the scrub summary
plus any stalls. Paste back the `#results` block and the heap lines;
until then the memory footprint stays labelled unmeasured.

## Retired numbers (do not cite)

- **1503 ms boundary swap stall.** Real measurement, wrong setup: headless
  Chrome, software decode, cold fetch of a 9.2 MB cut from the Vite dev
  server, timer running src-assignment → `playing`. It measures the
  headless pipeline, not the player. Superseded by the double-buffered
  player + headed protocol above.
- **33 ms scrub click-to-paint.** Measured against a 400×60 stand-in div,
  not the real timeline — citable-looking but meaningless. The synthetic
  lane is removed; scrub is measured against `[data-timeline-lane]` in
  headed.html.
