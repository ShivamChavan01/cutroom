# Cutroom perf notes

Measured numbers only. Anything not measured is labeled pending or retired —
see the bottom section before citing a number from an old commit message.

## Measured: engine ops (2026-10-14, dev machine, Node, `vitest bench`)

`packages/engine/src/engine.bench.ts`. Means:

| op | 20 clips | 1,000 clips |
|---|---|---|
| applyOp | 0.009 ms | 2.14 ms |
| diff | 0.08 ms | 5.11 ms |
| merge (clean) | — | 9.97 ms |
| merge (field conflict) | — | 13.21 ms |
| lint | 0.11 ms | 3.10 ms |

Reading: at prototype scale (tens of clips) every engine op is
sub-millisecond — the engine is not the bottleneck. At 1,000 clips the
costs are single-digit milliseconds, dominated by spreading the clips
record on each op (structural sharing keeps untouched clips identical by
reference, which is what lets the React selectors stay cheap). Re-run with
`pnpm --filter @cutroom/engine exec vitest bench --run`.

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
