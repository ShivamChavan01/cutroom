import { describe, expect, it } from "vitest";
import { makeClip } from "@cutroom/engine";
import { nextClip, resolveActiveClip } from "./playback";

const a = makeClip({
  id: "a",
  trackId: "v1",
  assetId: "asset-a",
  start: 0,
  inPoint: 1_000,
  duration: 4_000,
  volume: 1,
});
const b = makeClip({
  id: "b",
  trackId: "v1",
  assetId: "asset-b",
  start: 4_000,
  inPoint: 0,
  duration: 3_000,
  volume: 1,
});
const clips = [a, b];

describe("resolveActiveClip", () => {
  it("resolves mid-clip with the source offset applied", () => {
    const active = resolveActiveClip(clips, 2_500);
    expect(active?.clip.id).toBe("a");
    // inPoint 1000 + (2500 - 0)
    expect(active?.sourceTimeMs).toBe(3_500);
  });

  it("assigns an exact boundary to the clip starting there", () => {
    const active = resolveActiveClip(clips, 4_000);
    expect(active?.clip.id).toBe("b");
    expect(active?.sourceTimeMs).toBe(0);
  });

  it("returns null in a gap", () => {
    // Gap between 7000 and 9000.
    const gapped = [...clips, { ...b, id: "c", start: 9_000 }];
    expect(resolveActiveClip(gapped, 8_000)).toBeNull();
  });

  it("returns null before the first clip and after the last", () => {
    expect(resolveActiveClip(clips, -1)).toBeNull();
    expect(resolveActiveClip(clips, 7_000)).toBeNull();
    expect(resolveActiveClip(clips, 100_000)).toBeNull();
  });

  it("finds the next clip for preloading", () => {
    expect(nextClip(clips, a)?.id).toBe("b");
    expect(nextClip(clips, b)).toBeNull();
  });
});
