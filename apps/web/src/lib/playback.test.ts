import { describe, expect, it } from "vitest";
import { emptyTimeline, makeClip } from "@cutroom/engine";
import { advancePlayback, clipTransform, nextClip, playbackGain, resolveActiveClip, resolvePlaybackLayers } from "./playback";

const a = makeClip({
  id: "a",
  trackId: "v1",
  assetId: "asset-a",
  start: 0,
  inPoint: 1_000,
  duration: 4_000,
  volume: 1,
});

describe("layered playback", () => {
  it("preserves video layer order and includes independently timed audio", () => {
    const timeline = emptyTimeline();
    const upper = { ...a, id: "upper", trackId: "v2", inPoint: 500 };
    const sound = { ...a, id: "sound", trackId: "a1" };
    const result = resolvePlaybackLayers({
      ...timeline,
      tracks: [...timeline.tracks, { id: "v2", kind: "video", name: "V2", muted: false }],
      clips: { a, upper, sound },
    }, 1_000);
    expect(result.map((layer) => layer.clip.id)).toEqual(["a", "sound", "upper"]);
    expect(result[2]?.sourceTimeMs).toBe(1_500);
  });

  it("keeps a later video track visible when the first track is empty", () => {
    const timeline = emptyTimeline();
    const upper = { ...a, id: "upper", trackId: "v2" };
    const result = resolvePlaybackLayers({
      ...timeline,
      tracks: [...timeline.tracks, { id: "v2", kind: "video", name: "V2", muted: false }],
      clips: { upper },
    }, 100);
    expect(result.map((layer) => layer.clip.id)).toEqual(["upper"]);
  });

  it("excludes hidden tracks and returns no layer in a complete gap", () => {
    const timeline = { ...emptyTimeline(), clips: { a } };
    expect(resolvePlaybackLayers(timeline, 1_000, ["v1"])).toEqual([]);
    expect(resolvePlaybackLayers(timeline, 5_000)).toEqual([]);
  });

  it("applies the clip gain and independent track mute", () => {
    const track = emptyTimeline().tracks[0];
    if (track === undefined) throw new Error("missing test track");
    expect(playbackGain({ ...a, volume: 0.35 }, track)).toBe(0.35);
    expect(playbackGain(a, track, ["v1"])).toBe(0);
    expect(playbackGain(a, { ...track, muted: true })).toBe(0);
    expect(playbackGain({ ...a, volume: 2 }, track)).toBe(1);
    expect(playbackGain({ ...a, volume: -1 }, track)).toBe(0);
  });

  it("uses identity transform defaults for older clips", () => {
    expect(clipTransform(a)).toBe("translate(0px, 0px) rotate(0deg) scale(1, 1)");
    expect(clipTransform({ ...a, x: 24, y: -18, scaleX: 0.5, scaleY: 2, rotation: 90 }))
      .toBe("translate(24px, -18px) rotate(90deg) scale(0.5, 2)");
  });

  it("initializes from the first frame without a negative delta", () => {
    expect(advancePlayback({ at: 0, previousFrame: null, frame: 900, duration: 5_000 }))
      .toEqual({ time: 0, ended: false });
    expect(advancePlayback({ at: 250, previousFrame: 1_000, frame: 1_020, duration: 5_000 }))
      .toEqual({ time: 270, ended: false });
  });

  it("advances through gaps and stops exactly at the timeline end", () => {
    expect(advancePlayback({ at: 2_000, previousFrame: 1_000, frame: 2_000, duration: 10_000 }))
      .toEqual({ time: 3_000, ended: false });
    expect(advancePlayback({ at: 9_990, previousFrame: 1_000, frame: 1_100, duration: 10_000 }))
      .toEqual({ time: 10_000, ended: true });
    expect(advancePlayback({ at: 0, previousFrame: null, frame: 0, duration: 0 }))
      .toEqual({ time: 0, ended: true });
  });
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
