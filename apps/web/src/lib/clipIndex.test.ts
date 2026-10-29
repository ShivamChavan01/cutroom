import { describe, expect, it } from "vitest";
import {
  applyOp,
  clipsOnTrack,
  createHistory,
  current,
  emptyTimeline,
  makeClip,
  putAsset,
  record,
  redo,
  timelineDuration,
  undo,
  type Op,
  type Timeline,
} from "@cutroom/engine";
import { indexedClipsOnTrack, indexedTimelineDuration } from "./clipIndex";

function clip(id: string, start: number, trackId = "v1", duration = 1_000) {
  return makeClip({ id, start, trackId, duration, assetId: "asset", inPoint: 500, volume: 1 });
}

function expectMatchesEngine(timeline: Timeline): void {
  const trackIds = new Set([
    ...timeline.tracks.map((track) => track.id),
    ...Object.values(timeline.clips).map((item) => item.trackId),
    "missing",
  ]);
  for (const trackId of trackIds) {
    expect(indexedClipsOnTrack(timeline, trackId)).toEqual(clipsOnTrack(timeline, trackId));
  }
  expect(indexedTimelineDuration(timeline)).toBe(timelineDuration(timeline));
}

describe("clip index", () => {
  it("shares stable empty results for empty and unknown tracks", () => {
    const timeline = emptyTimeline();
    const empty = indexedClipsOnTrack(timeline, "v1");
    expect(empty).toEqual([]);
    expect(indexedClipsOnTrack(timeline, "missing")).toBe(empty);
    expect(indexedClipsOnTrack(emptyTimeline(), "other")).toBe(empty);
    expect(indexedTimelineDuration(timeline)).toBe(0);
  });

  it("matches engine ordering for unsorted tracks, overlaps and raw ID ties", () => {
    const timeline: Timeline = {
      ...emptyTimeline(),
      clips: {
        z: clip("z", 0),
        later: clip("later", 2_000),
        a: clip("a", 0, "v1", 5_000),
        A: clip("A", 0),
        audio: clip("audio", 600, "a1"),
        orphan: clip("orphan", 8_000, "unknown"),
      },
    };
    expectMatchesEngine(timeline);
    expect(indexedClipsOnTrack(timeline, "v1").map((item) => item.id))
      .toEqual(["A", "a", "z", "later"]);
    expect(indexedClipsOnTrack(timeline, "v1")[0]).toBe(timeline.clips.A);
    expect(indexedTimelineDuration(timeline)).toBe(9_000);
  });

  it("reuses clip arrays across timeline wrappers, assets and project metadata", () => {
    const base: Timeline = { ...emptyTimeline(), clips: { a: clip("a", 0) } };
    const ordered = indexedClipsOnTrack(base, "v1");
    const withAsset = putAsset(base, { id: "asset", kind: "video", duration: 50_000 });
    const renamed = applyOp(withAsset, { type: "renameProject", name: "new name" });
    const changedFps = applyOp(renamed, { type: "setFrameRate", fps: 24 });
    const addedTrack = applyOp(changedFps, {
      type: "addTrack",
      track: { id: "v2", name: "V2", kind: "video", muted: false },
    });
    for (const timeline of [{ ...base }, withAsset, renamed, changedFps, addedTrack]) {
      expect(timeline.clips).toBe(base.clips);
      expect(indexedClipsOnTrack(timeline, "v1")).toBe(ordered);
      expectMatchesEngine(timeline);
    }
  });

  it("invalidates edited revisions and leaves cached earlier revisions intact", () => {
    const base: Timeline = { ...emptyTimeline(), clips: { a: clip("a", 0), b: clip("b", 3_000) } };
    const original = indexedClipsOnTrack(base, "v1");
    const ops: readonly Op[] = [
      { type: "moveClip", clipId: "a", start: 8_000, trackId: "a1" },
      { type: "trimClip", clipId: "a", inPoint: 700, duration: 600 },
      { type: "setVolume", clipId: "a", volume: 0.25 },
      { type: "setTransform", clipId: "a", x: 12, rotation: 45 },
      { type: "splitClip", clipId: "a", at: 200 },
      { type: "deleteClip", clipId: "a" },
      { type: "addClip", clip: clip("c", 10_000) },
    ];
    let timeline = base;
    for (const op of ops) {
      timeline = applyOp(timeline, op);
      expectMatchesEngine(timeline);
      expect(indexedClipsOnTrack(base, "v1")).toBe(original);
      expect(original.map((item) => item.id)).toEqual(["a", "b"]);
      expect(indexedTimelineDuration(base)).toBe(4_000);
    }
    expect(indexedClipsOnTrack(timeline, "v1")).not.toBe(original);
    expect(indexedTimelineDuration(timeline)).toBe(11_000);
  });

  it("keeps equal project names and branch timelines independent", () => {
    const base: Timeline = { ...emptyTimeline("project"), clips: { a: clip("a", 0) } };
    const left = applyOp(base, { type: "moveClip", clipId: "a", start: 2_000 });
    const right = applyOp(base, { type: "moveClip", clipId: "a", start: 7_000 });
    const leftClips = indexedClipsOnTrack(left, "v1");
    expect(indexedTimelineDuration(left)).toBe(3_000);
    expect(indexedTimelineDuration(right)).toBe(8_000);
    expect(indexedClipsOnTrack(right, "v1")).not.toBe(leftClips);
    expect(indexedClipsOnTrack(left, "v1")).toBe(leftClips);
    expect(indexedTimelineDuration(base)).toBe(1_000);
  });

  it("matches replay through undo, redo, redo truncation and restored histories", () => {
    const base: Timeline = { ...emptyTimeline(), clips: { a: clip("a", 0) } };
    const moved = record(createHistory(base), { type: "moveClip", clipId: "a", start: 4_000 }, "alice");
    const trimmed = record(moved, { type: "trimClip", clipId: "a", duration: 500 }, "bob");
    const undone = undo(trimmed);
    const forked = record(undone, { type: "moveClip", clipId: "a", start: 8_000 }, "carol");
    for (const history of [moved, trimmed, undone, redo(undone), undo(undone), forked, { ...trimmed }]) {
      expectMatchesEngine(current(history));
    }
    expect(indexedTimelineDuration(current(trimmed))).toBe(4_500);
    expect(indexedTimelineDuration(current(undone))).toBe(5_000);
    expect(indexedTimelineDuration(current(forked))).toBe(9_000);
  });
});
