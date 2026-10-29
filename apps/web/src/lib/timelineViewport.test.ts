import { describe, expect, it } from "vitest";
import { makeClip } from "@cutroom/engine";
import { createTimeScale } from "./timeScale";
import {
  clipsInTimelineWindow,
  intersectsTimelineWindow,
  rulerTicksInTimelineWindow,
  timelineWindow,
} from "./timelineViewport";

function clip(id: string, start: number, duration: number) {
  return makeClip({ id, start, duration, trackId: "v1", assetId: "a", inPoint: 0, volume: 1 });
}

describe("timeline viewport", () => {
  it("converts horizontal scrolling and overscan without moving the time origin", () => {
    const scale = createTimeScale(100);
    expect(timelineWindow({ scrollLeft: 0, width: 800, scale })).toEqual({ start: 0, end: 11_000 });
    expect(timelineWindow({ scrollLeft: 1_000, width: 800, scale })).toEqual({ start: 7_000, end: 21_000 });
    expect(timelineWindow({ scrollLeft: 1_000, width: 800, scale: createTimeScale(50), overscan: 0 }))
      .toEqual({ start: 20_000, end: 36_000 });
  });

  it("includes spanning clips, both visual boundaries and pinned offscreen clips", () => {
    const clips = [clip("before", 0, 100), clip("left", 500, 500), clip("spanning", 0, 4_000),
      clip("inside", 1_200, 100), clip("right", 2_000, 100), clip("after", 3_000, 100)];
    const window = { start: 1_000, end: 2_000 };
    expect(clipsInTimelineWindow(clips, window).map((item) => item.id))
      .toEqual(["left", "spanning", "inside", "right"]);
    expect(clipsInTimelineWindow(clips, window, ["before", "after", null]).map((item) => item.id))
      .toEqual(clips.map((item) => item.id));
    expect(clipsInTimelineWindow([], window)).toEqual([]);
    expect(clips.map((item) => item.id)).toEqual(["before", "left", "spanning", "inside", "right", "after"]);
  });

  it("retains long move links and conflict bands crossing the viewport", () => {
    const window = { start: 10_000, end: 20_000 };
    expect(intersectsTimelineWindow(0, 30_000, window)).toBe(true);
    expect(intersectsTimelineWindow(15_000, 15_000, window)).toBe(true);
    expect(intersectsTimelineWindow(0, 9_999, window)).toBe(false);
    expect(intersectsTimelineWindow(20_001, 30_000, window)).toBe(false);
  });

  it("renders ruler marks at global step multiples while bounding work to the viewport", () => {
    const scale = createTimeScale(50);
    expect(rulerTicksInTimelineWindow({ start: 21_100, end: 26_100 }, scale, 1_000_000))
      .toEqual([20_000, 22_000, 24_000, 26_000]);
    expect(rulerTicksInTimelineWindow({ start: 0, end: 10_000 }, createTimeScale(100), 250))
      .toEqual([0, 1_000, 2_000]);
    expect(rulerTicksInTimelineWindow({ start: 10_000, end: 11_000 }, scale, 100)).toEqual([]);
  });
});
