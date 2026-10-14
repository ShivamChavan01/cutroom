import { useEffect, useState } from "react";
import {
  applyOps,
  diffTimelines,
  emptyTimeline,
  lint,
  makeClip,
  mergeTimelines,
  putAsset,
} from "@cutroom/engine";

/**
 * Engine-in-browser harness. Measures engine ops inside a real browser JS
 * runtime (JIT, GC) as opposed to Node:
 *
 *   google-chrome --headless --dump-dom http://localhost:5173/perf.html
 *
 * Deliberately engine-only. Scrub latency and boundary-swap stall are
 * playback measurements and live in headed.html, taken against the real
 * timeline lane in headed Chrome. An earlier version of this page measured
 * scrub against a stand-in div; that number (33ms) was citable-looking but
 * meaningless, and is retired — see PERF.md.
 */

interface Measurement {
  readonly label: string;
  readonly samples: number;
  readonly meanMs: number;
  readonly p99Ms: number;
}

function summarize(label: string, samples: number[]): Measurement {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    label,
    samples: samples.length,
    meanMs: mean,
    p99Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0,
  };
}

function buildTimeline(clipCount: number) {
  let t = emptyTimeline("perf");
  t = putAsset(t, { id: "asset-a", kind: "video", duration: 100_000_000 });
  return applyOps(
    t,
    Array.from({ length: clipCount }, (_, i) => ({
      type: "addClip" as const,
      clip: makeClip({
        id: `c${i}`,
        trackId: i % 2 === 0 ? "v1" : "a1",
        assetId: "asset-a",
        start: i * 1_000,
        inPoint: 0,
        duration: 900,
        volume: 1,
      }),
    })),
  );
}

function timeEngineOps(): Measurement[] {
  const out: Measurement[] = [];
  for (const count of [20, 1_000]) {
    const t = buildTimeline(count);
    const N = count === 20 ? 200 : 50;

    const applyOpSamples: number[] = [];
    for (let i = 0; i < N; i++) {
      // Pick ids that exist at this timeline size; ids beyond the clip count
      // would make applyOp throw, which the harness itself just proved.
      const start = performance.now();
      applyOps(t, [
        { type: "setVolume", clipId: `c${i % count}`, volume: 0.5 },
      ]);
      applyOpSamples.push(performance.now() - start);
    }

    const edited = applyOps(t, [
      { type: "moveClip", clipId: `c${Math.floor(count / 2)}`, start: 5_000 },
    ]);
    const diffSamples: number[] = [];
    for (let i = 0; i < N; i++) {
      const start = performance.now();
      diffTimelines(t, edited);
      diffSamples.push(performance.now() - start);
    }

    const lintSamples: number[] = [];
    for (let i = 0; i < N; i++) {
      const start = performance.now();
      lint(edited);
      lintSamples.push(performance.now() - start);
    }

    const ours = applyOps(t, [
      { type: "moveClip", clipId: `c${Math.min(10, count - 1)}`, start: 900 },
    ]);
    const theirs = applyOps(t, [
      { type: "moveClip", clipId: `c${Math.min(20, count - 1)}`, start: 900 },
    ]);
    const mergeSamples: number[] = [];
    for (let i = 0; i < N; i++) {
      const start = performance.now();
      mergeTimelines(t, ours, theirs);
      mergeSamples.push(performance.now() - start);
    }

    out.push(
      summarize(`applyOp @ ${count} clips`, applyOpSamples),
      summarize(`diff @ ${count} clips`, diffSamples),
      summarize(`lint @ ${count} clips`, lintSamples),
      summarize(`merge @ ${count} clips`, mergeSamples),
    );
  }
  return out;
}

export function PerfHarness() {
  const [results, setResults] = useState<Measurement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setResults(timeEngineOps());
      document.title = "PERF-DONE";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      document.title = "PERF-ERROR";
    }
  }, []);

  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: 24 }}>
      <h1>perf harness (engine only)</h1>
      <pre id="results">
        {error !== null
          ? `ERROR: ${error}`
          : results === null
            ? "running…"
            : results
                .map(
                  (r) =>
                    `${r.label.padEnd(24)} n=${String(r.samples).padStart(4)}  mean=${r.meanMs.toFixed(4)}ms  p99=${r.p99Ms.toFixed(4)}ms`,
                )
                .join("\n")}
      </pre>
    </main>
  );
}
