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

## Continuous timeline scrubbing

Five paired headless Chrome 158 runs alternated the order of two production
builds. Each run imported two six-second 1080p H.264 sources at 30 fps and
dragged from 4.4 to 7.6 seconds across the cut over roughly one second.
Video frame callbacks counted distinct preview frames within that range during
the drag and timed the target frame after release.

| Metric | Before | After |
| --- | --- | --- |
| Distinct frames shown during the drag | 0 in every run | median 3, range 3–4 |
| Release to target frame | median 246 ms, range 212–327 ms | median 307 ms, range 244–359 ms |

The player now lets the current seek finish during a paused drag on a video track.
When it finishes, the player reads the latest playhead position. Releasing the
pointer allows an immediate exact seek. Every run reached the target frame.
The drag still looks choppy on this fixture, and release took longer on median.
These results cover a short synthetic cut in one browser.

Use `scripts/verify-scrubbing.mjs` with `--continuous` to repeat the comparison.
Raw local results are in `.gstack/scrub-performance/continuous-final.json`.

## Multi-track playback and editing, 2026-11-19

A three-minute project contains 240 three-second clips on two simultaneous video
tracks and two audio tracks. The fixture reuses two six-second 1080p30 H.264
sources and one WAV. Headed Chrome 158 restored the project from IndexedDB and
its media from OPFS in an isolated profile. The production editor played three
12-second windows near the beginning, middle, and end. This measures the cost
of active tracks and cuts with a small source library.

| Metric across the three windows in the paired run | Before | After |
| --- | ---: | ---: |
| Timeline seconds advanced in 36 seconds | 33.8 | 36.0 |
| Observed playhead update gaps of at least 150 ms | 19 | 0 |
| Media element load starts during playback | 26 | 2 |
| Dropped / total video frames reported by Chrome across both tracks and their preload slots | 79 / 3,135 | 80 / 3,034 |

The paired results come from `.gstack/multitrack/baseline-2.json` and
`.gstack/multitrack/final-2.json`. An earlier baseline advanced only 18.4
seconds in the same 36-second workload. The final repeat in
`.gstack/multitrack/final-4.json` advanced 35.9 seconds, with two loads and
one 207 ms gap. An intervening run recorded gaps around one second in one
window and later timed out in the edit probe. The final repeat located the
ruler again before the edit probe and verified all 15 edit/undo cycles and
four-track pause, resume and source-time alignment. The playhead and frame-drop
counters measure different things. The playhead can catch up after a delayed
browser update even when the user saw a hitch.

Previously, ready tracks continued playing while the timeline clock waited
for another track to seek. They drifted and needed additional correction seeks.
The player now pauses the ready tracks with the timeline and resumes them when
the active media is ready. It also cues the next in-point on a parked media
element when that source is already loaded. The first updated window loaded
two video slots. The other two windows reused them.

After forced garbage collection, the updated JavaScript heap was 5.35 MiB on
load, 9.54 MiB after the playback windows, then 12.73, 12.90 and 12.94 MiB
after batches of five split/undo operations. The baseline ended at 12.95 MiB.
These short samples omit decoder buffers, GPU memory and browser process
memory.

Run from the repo root with a production build and two distinct six-second
1080p30 H.264 clips. Set `PLAYWRIGHT_MODULE` if Playwright is installed
outside the workspace. The optional verification step holds one video track
in a buffering state and checks the other tracks pause and resume with it.

```bash
node scripts/measure-multitrack.mjs apps/web/dist /path/to/a.mp4 /path/to/b.mp4 results.json --verify
```

## Pending: standalone preload-on vs preload-off comparison

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

## Ten-minute source, November 20, 2026

One local run in headed Chrome 158 used the production build and a synthetic 600-second 1280×720 H.264 file at 30 fps with AAC audio, generated with `bash scripts/make-test-media.sh 600`.

In the normal editor, the file was imported through the file input. The test held the pointer down on the timeline ruler and moved to 60 positions across the file, waiting up to two seconds for each destination. All 60 moves reached the expected playhead position and produced a video-frame callback on the active video with a matching media timestamp (within one frame). Pointer move to matching callback took 365 ms at the median, 532 ms at the 95th percentile, and 615 ms at the maximum. Seven moves exceeded 500 ms. These are isolated jumps with time to settle between them. Rapid uninterrupted dragging is a separate workload.

After forced collection, the editor's JS heap measured 4.02 MiB before import, 5.26 MiB after import, and 5.86, 6.00, and 6.10 MiB after batches of 20 jumps. It remained at 6.10 MiB after five idle seconds. Decoder buffers, GPU memory, and total renderer memory are outside these readings.

The standalone headed page played 64.71 seconds of media over a 65.01-second observation, with two additional dropped frames in Chrome's counter. Its click-to-repaint median was 33 ms. That timer waits for two animation frames and cannot establish when the destination video frame arrived. The standalone page's source-assignment-to-first-play timer also includes time spent paused. A subsequent pointer probe on this page failed to reach its intended targets and was excluded from the editor measurements.

Local evidence: `.gstack/scrub-performance/long-clip/editor-results.json` contains the editor input and frame samples. The sibling `results.json` contains the standalone playback observation and excluded probe.

### Where long seeks spend their time

Two instrumented runs repeated the same 60 ruler drags on the same production build and ten-minute source. Each sample records pointer move, the first assignment of the requested time to the active video's `currentTime`, and the matching frame's `presentationTime` from Chrome. The last timestamp marks submission for composition. It differs from the callback timestamp used in the initial run. A third run waited for the initial ruler press to finish seeking before moving the pointer. That deliberate wait is outside its measurement window.

| Median time (ms) | Drag run 1 | Drag run 2 | Previous seek settled |
| --- | ---: | ---: | ---: |
| Pointer move to seek request | 205 | 223 | 2 |
| Seek request to frame submission | 247 | 263 | 223 |
| Pointer move to frame submission | 455 | 460 | 226 |

All 180 drags reached their intended timeline position and frame. Stage medians are calculated separately. A previous seek was active on 54/60 and 55/60 moves in the ordinary runs, and on 0/60 in the control. The wait in the player’s scrub handler allows an outstanding seek to finish before it requests the latest time. The second run's slowest jump, to 140 s, spent 474 ms before the request and 377 ms after it.

The source has a keyframe roughly every 8.33 seconds. In the two ordinary runs, the correlation between distance from the preceding keyframe and request-to-submission time was 0.97 and 0.98. This interval includes browser scheduling, media access, decode and compositor submission. The trace does not isolate decoder CPU time.

Local traces are in `.gstack/scrub-performance/long-clip/seek-profile-{1,2}.json` and `seek-settled.json`.

### Replacing an obsolete seek during a large jump

During a paused video drag, the player can now replace one in-flight seek when two consecutive timeline positions differ by at least 10 seconds. A new drag resets the allowance. This threshold was chosen to target discontinuous moves. The experiment did not tune it or establish an optimal cutoff.

Five paired runs in headed Chrome 158 compared production builds before and after the change. Each run imported the same 600-second 720p30 H.264 fixture, used 12 matched destinations and alternated which build ran first between pairs. All 120 jumps landed at the requested playhead position and presented the matching frame while the pointer was held. Each stage below is summarized independently.

| Long-jump measurement | Before | After |
| --- | ---: | ---: |
| Pooled median move to frame submission | 496 ms | 293 ms |
| Range of the five run medians | 411–541 ms | 233–318 ms |
| Median move to request for the target | 203 ms | 7 ms |
| Median target request to frame submission | 281 ms | 285 ms |
| Jumps taking over 500 ms | 28/60 | 4/60 |

Each run also jumped from around 5 s to 55 s, swept to 139 s over 120 animation frames and released at 140 s. All ten sweeps showed intermediate frames and the correct release frame. The before and after builds both showed a median of five distinct intermediate frames (ranges 3–5 and 4–6). Continuous fast dragging on this long-keyframe-interval source still gives sparse visual feedback. In a separate five-pair, two-source cross-cut gesture check, both builds showed intermediate frames and reached the expected final source frame. The updated build also passed release, cancellation, keyboard, lane click and subsequent playback checks.

Raw timings and the local long-jump driver are under `.gstack/scrub-performance/long-jump-comparison/`. The cross-cut test uses `scripts/verify-scrubbing.mjs --continuous` with the two builds and six-second sources.

### Scrubbing with a lower-resolution copy

An experimental production build of the editor selected a local proxy blob for the active video only while dragging. The existing player slots switched back to the imported original on release. Both controls used the same build with the proxy disabled. The production editor has no proxy-generation or switching feature enabled.

Headed Chrome 158 imported the same 600 s, 720p30, 14.87 MiB synthetic H.264 clip in a fresh context per trial. Each profile had five paired runs with alternating order. Each sweep moved across 55–139 s over 120 animation frames and released at 140 s. Counts include distinct frame timestamps submitted for composition by the visible live video from the intended source during the sweep. Release timing ends on the matching original frame from the original blob, verified at 1280×720. Medians below are per sweep.

| Preview during drag | Distinct frames (range) | Frames shown per second of dragging | Release to original frame | Extra storage | Encode wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original, first control | 7 (5–7) | 3.0 | 333 ms | — | — |
| 360p30, keyframe every 0.2 s | 107 (99–111) | 51.0 | 391 ms | 16.04 MiB | 66.47 s |
| Original, second control | 7 (6–9) | 3.3 | 329 ms | — | — |
| 360p15, keyframe every 1 s | 92 (88–93) | 42.6 | 453 ms | 5.39 MiB | 41.69 s |

All 20 sweeps presented the original frame at exactly 140 s. The timeline JSON exported after the final smaller-proxy trial referenced the sole original 1280 px asset. Playback-rate fps and the count per second of rapid dragging refer to different clocks: the pointer traversed roughly 84 seconds of footage in two seconds.

Generation used native FFmpeg with libx264, three encoder threads, the veryfast preset, no B-frames or audio, and CRF 27 or 30 respectively. Reported generation times are single local encodes. The preview file was prepared before each measured sweep. These tests cover one synthetic source and a single visible video layer. In-browser generation cost, caching across sessions, and multi-camera behavior remain unmeasured. The smaller profile merits a user-facing prototype that retains the preview until the original frame is ready. Local raw samples and experiment drivers are in `.gstack/scrub-performance/proxy-experiment/`.

### Resolution stress test on matched edited footage

A benchmark-only production build imported the same 48-second excerpt at 1280×720, 1920×1080 and 3840×2160. The source was a 1080p edit. The 4K rendition was upscaled and encoded at 9.27 Mb/s. All sources were H.264 at 30 fps with an eight-second keyframe interval. Each preview was a silent 15 fps encode with one-second keyframes. Native FFmpeg encode times include decoding the source. They are single local runs outside the browser timings.

Headed Chrome 158 ran at a 1440×960 viewport on Radeon Vega 8. Chrome reported the VA-API platform decoder for all three resolutions. Each setting had five trials in fresh browser contexts, reversing test order on alternate rounds. Matched sweeps advanced the pointer for 120 animation frames, including forward and reverse moves and five release positions. A distinct frame counted only when the visible live video submitted the expected source and resolution in the swept media-time range. Rates use each sweep's measured wall time. Exact restore requires the original source and resolution within half a frame of the destination, with a five-second observation limit. These measurements cover one video layer and prepared proxies.

| Source | Drag preview | Distinct frames, median (range) | Frames/s during drag | Median / worst release (ms) | Exact restores | Proxy MiB / encode seconds |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 720p | Original | 5 (4–9) | 2.3 | 294.0 / 411 | 5/5 | — |
| 720p | 360p | 97 (91–104) | 48.2 | 313.0 / 508 | 5/5 | 1.24 / 4.9 |
| 1080p | Original | 1 (1–3) | 0.5 | 542.0 / 636 | 5/5 | — |
| 1080p | 360p | 105 (95–111) | 52.7 | 556.0 / 634 | 5/5 | 1.23 / 10.5 |
| 2160p | Original | 1 (0–1) | 0.2 | 2064.0 / 2393 | 5/5 | — |
| 2160p | 360p | 107 (96–109) | 52.0 | 2055.0 / 2380 | 5/5 | 1.24 / 21.6 |
| 2160p | 720p | 50 (49–51) | 24.6 | 2077.0 / 2384 | 5/5 | 3.59 / 25.0 |
| 2160p | 1080p | 32 (27–34) | 15.1 | 2060.0 / 2402 | 5/5 | 7.50 / 30.8 |
| 2160p | 2160p | 22 (19–25) | 5.1 | 2228.0 / 2630 | 5/5 | 26.08 / 87.4 |

Playback counters below aggregate three five-second windows per source. The timing starts once playback is active. These short observations do not establish sustained 4K playback performance.

720p playback: 14.75 s advanced in 15.02 s, 1 dropped of 445 reported frames.
1080p playback: 14.71 s advanced in 15.02 s, 4 dropped of 445 reported frames.
2160p playback: 14.82 s advanced in 15.03 s, 1 dropped of 449 reported frames.

Raw measurements, encoding commands, browser decoder information and the test driver are under `.gstack/scrub-performance/resolution-stress/`. Source media is excluded from the saved measurements.

### Full-resolution 4K and 8K editing baseline

The editor imported one 12-second H.264 clip per trial. Both files came from the same upscaled 1080p edit at 30 fps, with a four-second keyframe interval and no audio. The 4K fixture averaged 14.26 Mb/s and the 8K fixture 46.43 Mb/s. Headed Chrome 158 ran on Radeon Vega 8 at a 1440×960 viewport. The monitor used the original file throughout.

Three trials per resolution alternated test order and included forward and reverse sweeps in fresh browser contexts. Each sweep sent 120 pointer moves paced by animation frames. Release latency ends when the live video presents the original frame within half a frame of the target. Playback figures sum three subsequent three-second windows sampled on the active video element.

| Original | Chrome decoder | Distinct intermediate frames per sweep | Median wait after release | Media time advanced / wall time |
| --- | --- | ---: | ---: | ---: |
| 3840×2160 | VA-API hardware | 4, 5, 4 | 1.28 s | 9.04 / 9.04 s |
| 7680×4320 | FFmpeg software | 0, 0, 0 | 3.80 s | 2.02 / 9.06 s |

All six releases reached the target frame within five seconds. The active 8K video element was paused at the end of all three playback samples. These observations establish the symptom on this machine. They do not isolate decoding cost from the editor’s playback coordination. The fixtures exercise full-resolution decoding in a scaled monitor. Camera originals, sustained playback, and layered 8K timelines remain untested. The earlier 48-second stress test used a different encode and keyframe interval.

Raw samples, GPU information and the browser driver are under `.gstack/scrub-performance/full-resolution-8k/`.

### Why the 8K player paused and the 4K seek took so long

On the same laptop and production build, three single-layer 8K trials traced the editor's playhead, media events, application calls to `pause()`, writes to `currentTime`, and the decoder selected by Chrome. In all three trials, playback entered `waiting`. The timeline advanced until it led the video by 328–414 ms. The track player corrected the difference by seeking. On the following buffering check, the editor called `pause()` on the seeking element. All three observation windows ended with the video paused. A separate run in the shared browser also reproduced the seek followed by the editor's pause.

Across the three short windows, the editor's media clock advanced 1.51 s in 9.09 s, including jumps from seek corrections. A plain video element playing the same 8K file from the same positions advanced 3.65 s in 9.01 s and reported 71 dropped frames out of 113. Chrome used its software decoder. The plain player also fell behind real time. Sampling started after each player attempted playback, so these totals describe observed progress and cannot isolate an exact cost per seek.

For 4K, two H.264 files encoded from the same 12-second original differed only in the configured keyframe interval. The four-second encode averaged 14.23 Mb/s and the one-second encode 15.19 Mb/s. Both kept the same 3840×2160 resolution, 30 fps, encoder preset and CRF. Frame timestamps confirmed the encoded interval. At the 3.9 s destination, the editor requested the target within 6 ms on both encodes. The original frame appeared after 1,424 ms with four-second keyframes and 373 ms with one-second keyframes. At 4.5 s both files had a keyframe just half a second earlier, and the waits were 237 ms and 233 ms respectively.

An independent plain-video seek from the start in a fresh page reproduced the pattern. Across six paired destinations (3, 3.9, 4.5, 6.5, 7 and 7.9 s), median time from assigning the source time to presenting the correct frame was 1,183 ms with four-second keyframes and 251 ms with one-second keyframes. Two simulated editor drags initially missed their scheduled release positions. Those attempts are preserved in the traces and both retries landed correctly. Across the six matched editor destinations, including those retries, median release-to-frame latency was 1,381 ms with four-second keyframes and 234 ms with one-second keyframes. The editor issued the final seek within 7 ms on every valid release. The benchmark used upscaled footage. It does not establish sustained or multilayer playback on camera originals.

Raw samples and drivers are under `.gstack/scrub-performance/full-resolution-diagnosis/`.

### Source-resolution playback and editing copies

Cutroom now paces a single active video by its media clock. While the decoder waits, the timeline holds its position and the element can resume on its own. Multiple active media tracks still pause together during buffering. Gaps use elapsed wall time.

The 8K regression check opened the same upscaled 7680×4320 H.264 original on both builds and played three windows from approximately 0, 3 and 6 seconds. The earlier player issued three seeking events and three pauses during playback. The final build presented 45 frame callbacks in 9.03 seconds with zero correction requests or pause events. The media clock advanced 4.44 seconds, and the timeline ended each window within 129 ms of it. This confirms recovery from decoder stalls, while the software decoder still falls behind 30 fps. Frame counts and throughput are sensitive to other activity on this laptop.

The 240-clip multitrack regression advanced 35.67 s in 36.13 s across three playback windows. The first window loaded two additional video sources. The next two windows reused the existing slots. The test verified coordinated pause and recovery after a forced stall and audio synchronization within 250 ms while moving from solo video to video plus audio and back across cuts.

**Media → File details → Prepare editing copy…** saves a separate full-resolution H.264 MP4 with a maximum one-second keyframe interval. The player previews that file for this session and **Use original** switches back. The project asset ID, original media and timeline export keep pointing at the imported source. The browser loads the encoder on demand. Preparation requires WebCodecs, a local save picker, and one opaque SDR video track. A canceled or failed encode leaves the original active.

In headed Chrome 158 on Radeon Vega 8, the editor imported a 12-second 3840×2160 H.264 video with four-second keyframes and AAC audio. The test clicked six timeline positions, prepared a copy through File details, repeated the clicks, and switched back to the original. Both files contained all 360 video frames at 30 fps. The decoded AAC samples had identical SHA-256 hashes. The automated picker supplied a local browser file handle. Encoding, saving, previewing, and reverting all used the application code.

| 4K source | Median click to target frame | Slowest click | File size |
| --- | ---: | ---: | ---: |
| Imported file | 1,738 ms | 2,256 ms | 20.46 MiB |
| Browser-prepared copy | 361 ms | 590 ms | 30.18 MiB |

The copy took 57.8 seconds to prepare. Each click required a presented frame within one source frame of the requested position. These are six matched clicks on one upscaled edit. The encoding changes image compression and uses additional disk space. Raw measurements and the 4K browser driver are under `.gstack/scrub-performance/original-playback-fix/`. The repeatable 8K check is `node scripts/verify-video-clock.mjs <production-build> <video> <result.json>` with the same headed Chrome setup as the multitrack benchmark.

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
