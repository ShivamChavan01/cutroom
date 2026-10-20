import { describe, expect, it } from "vitest";
import {
  formatRulerTime,
  formatTimecode,
  nextCut,
  previousCut,
} from "./timecode";

describe("formatTimecode", () => {
  it("formats HH:MM:SS:FF at 30fps", () => {
    expect(formatTimecode(0)).toBe("00:00:00:00");
    expect(formatTimecode(1_000)).toBe("00:00:01:00");
    expect(formatTimecode(61_500)).toBe("00:01:01:15");
    expect(formatTimecode(3_661_200)).toBe("01:01:01:06");
  });

  it("clamps negative times to zero", () => {
    expect(formatTimecode(-500)).toBe("00:00:00:00");
  });

  it("honours a different frame rate", () => {
    expect(formatTimecode(1_000, { fps: 24 })).toBe("00:00:01:00");
    expect(formatTimecode(500, { fps: 24 })).toBe("00:00:00:12");
  });
});

describe("formatRulerTime", () => {
  it("formats MM:SS", () => {
    expect(formatRulerTime(0)).toBe("00:00");
    expect(formatRulerTime(65_000)).toBe("01:05");
  });
});

describe("cut navigation", () => {
  const cuts = [{ start: 0 }, { start: 4_000 }, { start: 9_000 }];

  it("finds the previous cut start", () => {
    expect(previousCut(cuts, 5_000)).toBe(4_000);
    expect(previousCut(cuts, 4_000)).toBe(0);
    expect(previousCut(cuts, 9_000)).toBe(4_000);
  });

  it("returns null before the first cut", () => {
    expect(previousCut(cuts, 0)).toBeNull();
  });

  it("finds the next cut start", () => {
    expect(nextCut(cuts, 0)).toBe(4_000);
    expect(nextCut(cuts, 4_000)).toBe(9_000);
    expect(nextCut(cuts, 8_999)).toBe(9_000);
  });

  it("returns null after the last cut", () => {
    expect(nextCut(cuts, 9_000)).toBeNull();
    expect(nextCut(cuts, 60_000)).toBeNull();
  });

  it("returns null with no cuts at all", () => {
    expect(previousCut([], 1_000)).toBeNull();
    expect(nextCut([], 1_000)).toBeNull();
  });
});
