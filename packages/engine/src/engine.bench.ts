import { bench, describe } from "vitest";
import {
  type Timeline,
  applyOps,
  diffTimelines,
  emptyTimeline,
  lint,
  makeClip,
  mergeTimelines,
  putAsset,
} from "./index";

/**
 * Engine cost at scale. These are the numbers the README cites, so they are
 * measured, not estimated: `vitest bench` re-runs them on demand.
 *
 * A realistic timeline is second-scale length with tens of throwaway clips;
 * 1000 clips on two tracks is far past prototype scale and included as a
 * ceiling, not a target.
 */
function buildTimeline(clipCount: number): Timeline {
  let t = emptyTimeline("bench");
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

const small = buildTimeline(20);
const large = buildTimeline(1_000);

describe("applyOp", () => {
  bench("20-clip timeline", () => {
    applyOps(small, [{ type: "setVolume", clipId: "c5", volume: 0.5 }]);
  });
  bench("1000-clip timeline", () => {
    applyOps(large, [{ type: "setVolume", clipId: "c500", volume: 0.5 }]);
  });
});

describe("diff", () => {
  const edited = applyOps(large, [{ type: "moveClip", clipId: "c750", start: 5_000 }]);
  bench("20 clips vs 20 clips", () => {
    diffTimelines(small, small);
  });
  bench("1000 clips vs 1000 clips", () => {
    diffTimelines(large, edited);
  });
});

describe("merge", () => {
  const smallOurs = applyOps(small, [{ type: "moveClip", clipId: "c2", start: 900 }]);
  const smallTheirs = applyOps(small, [{ type: "moveClip", clipId: "c7", start: 900 }]);
  bench("20 clips, clean merge", () => {
    mergeTimelines(small, smallOurs, smallTheirs);
  });
  const base = large;
  const ours = applyOps(base, [{ type: "moveClip", clipId: "c100", start: 900 }]);
  const theirs = applyOps(base, [{ type: "moveClip", clipId: "c300", start: 900 }]);
  bench("1000 clips, clean merge", () => {
    mergeTimelines(base, ours, theirs);
  });
  const conflicting = applyOps(base, [
    { type: "trimClip", clipId: "c100", inPoint: 500 },
  ]);
  const conflictingOurs = applyOps(base, [
    { type: "trimClip", clipId: "c100", inPoint: 100 },
  ]);
  bench("1000 clips, field conflict", () => {
    mergeTimelines(base, conflictingOurs, conflicting);
  });
});

describe("lint", () => {
  bench("20 clips", () => {
    lint(small);
  });
  bench("1000 clips", () => {
    lint(large);
  });
});
