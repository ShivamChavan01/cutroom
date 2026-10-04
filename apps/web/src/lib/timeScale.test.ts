import { describe, expect, it } from "vitest";
import { createTimeScale } from "./timeScale";

describe("timeScale", () => {
  it("places a 2s-start 3s-duration clip at left 100 width 150 at 50px/s", () => {
    const scale = createTimeScale(50);
    expect(scale.timeToPx(2000)).toBe(100);
    expect(scale.timeToPx(3000)).toBe(150);
  });

  it("round-trips time -> px -> time", () => {
    const scale = createTimeScale(80);
    expect(scale.pxToTime(scale.timeToPx(1234))).toBeCloseTo(1234, 6);
  });

  it("scales linearly with zoom", () => {
    expect(createTimeScale(100).timeToPx(1000)).toBe(
      createTimeScale(50).timeToPx(1000) * 2,
    );
  });

  it("rejects non-positive zoom", () => {
    expect(() => createTimeScale(0)).toThrow(/positive/);
  });
});
