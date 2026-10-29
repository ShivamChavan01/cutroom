import { describe, expect, it } from "vitest";
import {
  type Timeline,
  applyOp,
  applyOps,
  clipIsWellFormed,
  clipsOnTrack,
  emptyTimeline,
  makeClip,
  overlaps,
  splitChildId,
  timelineDuration,
} from "./index";
import { baseTimeline } from "./fixtures.js";

function add(
  timeline: Timeline,
  id: string,
  trackId: string,
  start: number,
  duration: number,
): Timeline {
  return applyOp(timeline, {
    type: "addClip",
    clip: makeClip({
      id,
      trackId,
      assetId: "asset-a",
      start,
      inPoint: 0,
      duration,
      volume: 1,
    }),
  });
}

describe("model", () => {
  it("derives track order from start, not from insertion order", () => {
    let t = emptyTimeline();
    t = add(t, "late", "v1", 5_000, 1_000);
    t = add(t, "early", "v1", 0, 1_000);
    t = add(t, "middle", "v1", 2_000, 1_000);

    expect(clipsOnTrack(t, "v1").map((c) => c.id)).toEqual(["early", "middle", "late"]);
  });

  it("treats intervals as half-open so adjacent clips do not overlap", () => {
    const t = emptyTimeline();
    const a = makeClip({
      id: "a",
      trackId: "v1",
      assetId: "asset-a",
      start: 0,
      inPoint: 0,
      duration: 5_000,
      volume: 1,
    });
    const b = { ...a, id: "b", start: 5_000 };

    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(a, { ...b, start: 4_999 })).toBe(true);
  });

  it("compares timeline intervals, not asset-local outPoints, away from the origin", () => {
    // Regression: overlaps() once compared a.start against clip.inPoint +
    // clip.duration, so two clips clashing at 10s went undetected whenever
    // their source media started at 0. Geometry runs on the timeline clock;
    // outPoint stays asset-local for the player.
    const a = makeClip({
      id: "a",
      trackId: "v1",
      assetId: "asset-a",
      start: 10_000,
      inPoint: 0,
      duration: 2_000,
      volume: 1,
    });
    const overlapping = { ...a, id: "b", start: 10_500 };
    const disjoint = { ...a, id: "c", start: 12_000 };

    expect(a.outPoint).toBe(2_000);
    expect(overlaps(a, overlapping)).toBe(true);
    expect(overlaps(overlapping, a)).toBe(true);
    expect(overlaps(a, disjoint)).toBe(false);
  });

  it("reports duration as the furthest clip end", () => {
    const t = add(emptyTimeline(), "c", "v1", 1_000, 2_500);
    expect(timelineDuration(t)).toBe(3_500);
  });

  it("rejects a zero-length clip as not well formed", () => {
    const zero = makeClip({
      id: "z",
      trackId: "v1",
      assetId: "asset-a",
      start: 0,
      inPoint: 0,
      duration: 0,
      volume: 1,
    });
    expect(clipIsWellFormed(zero)).toBe(false);
  });
});

describe("ops", () => {
  it("splits into two children that tile the parent exactly", () => {
    const base = baseTimeline();
    const t = applyOps(base, [{ type: "splitClip", clipId: "c1", at: 4_000 }]);
    const left = t.clips[splitChildId("c1", 4_000, "L")]!;
    const right = t.clips[splitChildId("c1", 4_000, "R")]!;

    expect(left.duration).toBe(4_000);
    expect(right.duration).toBe(6_000);
    expect(left.start).toBe(0);
    expect(right.start).toBe(4_000);
    expect(right.inPoint).toBe(4_000);
    expect(left.duration + right.duration).toBe(10_000);
    expect(t.clips.c1).toBeUndefined();
  });

  it("derives identical child IDs for the same split on independent branches", () => {
    const base = baseTimeline();
    const a = applyOps(base, [{ type: "splitClip", clipId: "c1", at: 4_000 }]);
    const b = applyOps(base, [{ type: "splitClip", clipId: "c1", at: 4_000 }]);
    expect(Object.keys(a.clips).sort()).toEqual(Object.keys(b.clips).sort());
  });

  it("normalizes sub-millisecond split points to the same child IDs", () => {
    // 1000.0 and 1000.0004 land on the same frame; they must not fork the ids.
    expect(splitChildId("c1", 1_000.0, "L")).toBe(splitChildId("c1", 1_000.0004, "L"));
  });

  it("is idempotent when the same split is applied twice", () => {
    const base = baseTimeline();
    const once = applyOps(base, [{ type: "splitClip", clipId: "c1", at: 4_000 }]);
    const twice = applyOps(once, [{ type: "splitClip", clipId: "c1", at: 4_000 }]);
    // The parent is gone, so this is a no-op rather than an error.
    expect(twice).toBe(once);
  });

  it("rejects a split at either extreme of the clip", () => {
    const base = baseTimeline();
    expect(() => applyOps(base, [{ type: "splitClip", clipId: "c1", at: 0 }])).toThrow(
      /outside clip/,
    );
    expect(() =>
      applyOps(base, [{ type: "splitClip", clipId: "c1", at: 10_000 }]),
    ).toThrow(/outside clip/);
  });

  it("cascades a delete through children produced by splits", () => {
    let t = baseTimeline();
    t = applyOps(t, [{ type: "splitClip", clipId: "c1", at: 4_000 }]);
    t = applyOps(t, [{ type: "deleteClip", clipId: "c1" }]);
    expect(t.clips).toEqual({});
  });

  it("trims while keeping outPoint consistent", () => {
    const t = applyOps(baseTimeline(), [
      { type: "trimClip", clipId: "c1", inPoint: 1_000, duration: 2_000 },
    ]);
    expect(t.clips.c1?.outPoint).toBe(3_000);
    expect(clipIsWellFormed(t.clips.c1!)).toBe(true);
  });

  it("rejects a trim that would produce a zero-length clip", () => {
    expect(() =>
      applyOps(baseTimeline(), [{ type: "trimClip", clipId: "c1", duration: 0 }]),
    ).toThrow(/zero-length/);
  });

  it("rejects a move to an unknown track", () => {
    expect(() =>
      applyOps(baseTimeline(), [
        { type: "moveClip", clipId: "c1", start: 0, trackId: "nope" },
      ]),
    ).toThrow(/unknown track/);
  });

  it("rejects an out-of-range volume instead of clamping silently", () => {
    expect(() =>
      applyOps(baseTimeline(), [{ type: "setVolume", clipId: "c1", volume: 1.5 }]),
    ).toThrow(/outside \[0, 1\]/);
  });

  it("never mutates the timeline it was given", () => {
    const base = baseTimeline();
    const before = JSON.stringify(base);
    applyOps(base, [{ type: "moveClip", clipId: "c1", start: 5_000 }]);
    expect(JSON.stringify(base)).toBe(before);
  });

  it("throws rather than silently dropping an op on an unknown clip", () => {
    // A silently dropped op is indistinguishable from a lost one three commits
    // later, so an unapplicable op must be loud.
    expect(() =>
      applyOps(baseTimeline(), [{ type: "deleteClip", clipId: "ghost" }]),
    ).toThrow(/unknown clip/);
  });
});

it.each([NaN, Infinity, -Infinity])("rejects non-finite timing %s without mutating the timeline", value => {
  const base = applyOp(emptyTimeline(), { type: "addClip", clip: makeClip({ id: "finite", assetId: "media", trackId: "v1", start: 0, inPoint: 0, duration: 1000, volume: 1 }) });
  const before = JSON.stringify(base);
  expect(() => applyOp(base, { type: "moveClip", clipId: "finite", start: value })).toThrow();
  expect(() => applyOp(base, { type: "splitClip", clipId: "finite", at: value })).toThrow();
  expect(() => applyOp(base, { type: "trimClip", clipId: "finite", inPoint: value })).toThrow();
  expect(JSON.stringify(base)).toBe(before);
});
