# Cutroom perf notes

Measured numbers only. Anything not measured is labeled pending or retired —
see the bottom section before citing a number from an old commit message.

## Measured: engine ops (dev machine, Node, `vitest bench`)

`packages/engine/src/engine.bench.ts`. Medians of 3 back-to-back runs on
2026-10-14 (means per run; full per-run table below):

| op | 20 clips | 1,000 clips |
|---|---|---|
| applyOp | 0.002 ms | 1.17 ms |
| diff | 0.012 ms | 0.75 ms |
| merge (clean) | — | 2.07 ms |
| merge (field conflict) | — | 3.09 ms |
| lint | 0.013 ms | 0.58 ms |

Per-run means (ms) — run 1 / run 2 / run 3:

| op | run 1 | run 2 | run 3 |
|---|---|---|---|
| applyOp @20 | 0.0017 | 0.0017 | 0.0017 |
| applyOp @1000 | 1.17 | 0.93 | 1.17 |
| diff @20 | 0.0122 | 0.0106 | 0.0118 |
| diff @1000 | 0.76 | 0.74 | 0.75 |
| merge clean @1000 | 2.38 | 2.07 | 2.05 |
| merge conflict @1000 | 2.68 | 3.09 | 3.11 |
| lint @20 | 0.0131 | 0.0125 | 0.0133 |
| lint @1000 | 0.54 | 0.74 | 0.58 |

On the 0.70 ms vs 2.14 ms applyOp@1000 spread from earlier runs: same file,
same clip counts, same ops — vitest bench does its own warmup and adaptive
iterations in all runs, so the setup is identical. The spread is noise, not
method: this box is shared, per-run rme on the 1000-clip benches is ±5–9%,
max samples spike to 10–38 ms (GC/contention), and today's own three runs
already spread 0.93→1.17 (26%). 2.14 sits ~2x above today's median, consistent
with heavier concurrent load during that run.

Caveat (kept, not silently fixed, so runs stay comparable): the field-
conflict bench calls one extra `applyOps` trim *inside* the timed function
(`engine.bench.ts` line 74), so that number includes ~1 ms of applyOp at
1000 clips. True merge cost is roughly 1 ms lower than quoted.

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
