import { useEffect, useState } from "react";
import { emptyTimeline, makeClip, putAsset } from "@cutroom/engine";
import { Timeline } from "./components/Timeline";
import { Player } from "./components/Player";
import { registerAssetUrl } from "./lib/assets";
import { useEditorStore } from "./store";

/**
 * Headed measurement harness. Unlike perf.html (synthetic lane), this page
 * renders the REAL Timeline and Player, seeds two real assets, and drives
 * them the way a user would:
 *
 *   1. Click the real `[data-timeline-lane]` at 30 positions, measuring
 *      click -> store update -> painted frame for each.
 *   2. Press play and cross the a/b boundary, capturing the stall the
 *      Player records into window.__stalls.
 *
 * Run HEADED (headless uses software decode and inflates video timings):
 *
 *   google-chrome --autoplay-policy=no-user-gesture-required \
 *     "http://localhost:5173/headed.html?auto=1"               # preload on
 *   google-chrome --autoplay-policy=no-user-gesture-required \
 *     "http://localhost:5173/headed.html?auto=1&preload=off"   # preload off
 *
 * Repeat each 3+ times, take the median. Results render into #results and
 * document.title flips to HEADED-DONE when finished.
 */

function summarize(label: string, samples: number[]): string {
  if (samples.length === 0) return `${label}: no samples`;
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return (
    `${label}  n=${samples.length}  ` +
    `mean=${mean.toFixed(2)}ms  median=${median.toFixed(2)}ms  p99=${p99.toFixed(2)}ms`
  );
}

function seedTwoAssetTimeline(): void {
  const store = useEditorStore.getState();
  let base = emptyTimeline("headed");
  base = putAsset(base, { id: "asset-a", kind: "video", duration: 60_000 });
  base = putAsset(base, { id: "asset-b", kind: "video", duration: 60_000 });
  store.loadTimeline(base);
  registerAssetUrl("asset-a", "/test-a.mp4");
  registerAssetUrl("asset-b", "/test-b.mp4");
  store.dispatch({
    type: "addClip",
    clip: makeClip({
      id: "a", trackId: "v1", assetId: "asset-a",
      start: 0, inPoint: 0, duration: 4_000, volume: 1,
    }),
  });
  store.dispatch({
    type: "addClip",
    clip: makeClip({
      id: "b", trackId: "v1", assetId: "asset-b",
      start: 4_000, inPoint: 0, duration: 4_000, volume: 1,
    }),
  });
  store.setZoom(100);
}

function clickLaneAt(clientX: number, clientY: number): void {
  const lane = document.querySelector("[data-timeline-lane]");
  if (lane === null) throw new Error("real timeline lane not found");
  lane.dispatchEvent(
    new MouseEvent("click", { bubbles: true, clientX, clientY }),
  );
}

function measureRealScrub(): Promise<number[]> {
  const samples: number[] = [];
  return new Promise((resolve, reject) => {
    const lane = document.querySelector("[data-timeline-lane]");
    if (lane === null) {
      reject(new Error("real timeline lane not found"));
      return;
    }
    const rect = lane.getBoundingClientRect();
    const store = useEditorStore.getState();
    const pxPerSecond = store.pxPerSecond;
    const timeToPx = (ms: number): number => (ms / 1000) * pxPerSecond;
    let index = 0;

    const step = (): void => {
      // Stay inside clip a (0-4000ms) so every click resolves a clip.
      const targetMs = 200 + index * 120;
      const previous = useEditorStore.getState().playheadMs;
      const startedAt = performance.now();
      let done = false;
      const unsubscribe = useEditorStore.subscribe((state) => {
        if (done || state.playheadMs === previous) return;
        done = true;
        unsubscribe();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            samples.push(performance.now() - startedAt);
            index += 1;
            if (index < 30) step();
            else resolve(samples);
          }),
        );
      });
      clickLaneAt(rect.left + timeToPx(targetMs), rect.top + 10);
      // Safety: never hang the harness on a missed click.
      window.setTimeout(() => {
        if (!done) {
          done = true;
          unsubscribe();
          index += 1;
          if (index < 30) step();
          else resolve(samples);
        }
      }, 1000);
    };
    step();
  });
}

function playAcrossBoundary(): Promise<{ mode: string; ms: number }[]> {
  return new Promise((resolve) => {
    window.__stalls = [];
    const store = useEditorStore.getState();
    store.setPlayhead(500);
    // Give the paused sync a frame to settle, then play through 4000ms.
    window.setTimeout(() => {
      useEditorStore.getState().play();
      const check = (): void => {
        const state = useEditorStore.getState();
        if (state.playheadMs >= 7_500 || !state.isPlaying) {
          state.pause();
          resolve(window.__stalls ?? []);
          return;
        }
        window.setTimeout(check, 200);
      };
      check();
      // Hard cap: never hang the harness.
      window.setTimeout(() => {
        useEditorStore.getState().pause();
        resolve(window.__stalls ?? []);
      }, 30_000);
    }, 500);
  });
}

export function HeadedHarness() {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("auto")) {
      setLines(["pass ?auto=1 to run (headed Chrome only)"]);
      return;
    }
    void (async () => {
      try {
        seedTwoAssetTimeline();
        // Let React commit the seeded timeline before measuring.
        await new Promise((r) => window.setTimeout(r, 500));
        const scrub = await measureRealScrub();
        const stalls = await playAcrossBoundary();
        const out = [
          summarize("scrub click->paint (real lane)", scrub),
          stalls.length > 0
            ? stalls
                .map((s) => `boundary swap stall (${s.mode}): ${s.ms.toFixed(0)}ms`)
                .join("\n")
            : "boundary swap stall: no samples (playback did not cross?)",
        ];
        setLines(out);
        document.title = "HEADED-DONE";
      } catch (err) {
        setLines([`ERROR: ${err instanceof Error ? err.message : String(err)}`]);
        document.title = "HEADED-ERROR";
      }
    })();
  }, []);

  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: 24 }}>
      <h1>headed perf</h1>
      <Player />
      <Timeline />
      <pre id="results">
        {lines === null ? "running…" : lines.join("\n")}
      </pre>
    </main>
  );
}
