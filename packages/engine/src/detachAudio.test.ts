import { expect, it } from "vitest";
import { applyOp, authorsByClip, createHistory, current, detachedAudioId, diffTimelines, mergeTimelines, record, redo, undo } from "./index";
import { baseTimeline } from "./fixtures";

it("detaches the trimmed source and original gain atomically without changing the input", () => {
  let base = applyOp(baseTimeline(), { type: "moveClip", clipId: "c1", start: 2000 });
  base = applyOp(base, { type: "trimClip", clipId: "c1", inPoint: 3000, duration: 6000 });
  base = applyOp(base, { type: "setVolume", clipId: "c1", volume: 0.6 });
  const next = applyOp(base, { type: "detachAudio", clipId: "c1", trackId: "a1" });
  expect(next.clips[detachedAudioId("c1")]).toEqual({ ...base.clips.c1, id: "audio:c1", trackId: "a1" });
  expect(next.clips.c1?.volume).toBe(0);
  expect(base.clips.c1?.volume).toBe(0.6);
  expect(next.assets).toBe(base.assets);
  expect(() => applyOp(next, { type: "detachAudio", clipId: "c1", trackId: "a2" })).toThrow("already");
});

it("can create an audio track and undo/redo both the track and clips together", () => {
  const base = baseTimeline();
  const history = record(createHistory(base), { type: "detachAudio", clipId: "c1", trackId: "a2" }, "alice");
  expect(current(history).tracks.at(-1)).toEqual({ id: "a2", name: "A2", kind: "audio", muted: false });
  expect(current(undo(history))).toEqual(base);
  expect(current(redo(undo(history)))).toEqual(current(history));
  expect(authorsByClip(history).get("audio:c1")).toBe("alice");
  expect(authorsByClip(history).get("c1")).toBe("alice");
});

it("keeps detached audio independently editable and alive when video is deleted", () => {
  const base = applyOp(baseTimeline(), { type: "detachAudio", clipId: "c1", trackId: "a1" });
  const deleted = applyOp(base, { type: "deleteClip", clipId: "c1" });
  expect(deleted.clips["audio:c1"]).toEqual(base.clips["audio:c1"]);
  const split = applyOp(base, { type: "splitClip", clipId: "audio:c1", at: 3000 });
  expect(() => applyOp(split, { type: "detachAudio", clipId: "c1", trackId: "a2" })).toThrow("already");
});

it("rejects missing clips, non-video sources, wrong tracks, blank ids and occupied destinations", () => {
  const base = baseTimeline();
  for (const op of [
    { type: "detachAudio", clipId: "missing", trackId: "a1" },
    { type: "detachAudio", clipId: "c1", trackId: "v1" },
    { type: "detachAudio", clipId: "c1", trackId: "" },
  ] as const) expect(() => applyOp(base, op)).toThrow();
  const detached = applyOp(base, { type: "detachAudio", clipId: "c1", trackId: "a1" });
  expect(() => applyOp(detached, { type: "detachAudio", clipId: "audio:c1", trackId: "a2" })).toThrow("video");
  const occupied = { ...detached, clips: { ...base.clips, other: { ...detached.clips["audio:c1"]!, id: "other" } } };
  expect(() => applyOp(occupied, { type: "detachAudio", clipId: "c1", trackId: "a1" })).toThrow("occupied");
  const image = { ...base, assets: { "asset-a": { ...base.assets["asset-a"]!, kind: "image" as const } } };
  expect(() => applyOp(image, { type: "detachAudio", clipId: "c1", trackId: "a1" })).toThrow("video");
});

it("shows the new audio and silent video in diffs, and converges when both branches detach", () => {
  const base = baseTimeline();
  const detached = applyOp(base, { type: "detachAudio", clipId: "c1", trackId: "a1" });
  expect(diffTimelines(base, detached)).toMatchObject({ added: 1, changed: 1 });
  const merge = mergeTimelines(base, detached, detached);
  expect(merge.clean).toBe(true);
  expect(merge.merged).toEqual(detached);
});
