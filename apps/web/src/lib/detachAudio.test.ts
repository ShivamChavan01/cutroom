import { expect, it } from "vitest";
import { applyOp, emptyTimeline, makeClip, putAsset } from "@cutroom/engine";
import { planAudioDetach } from "./detachAudio";

function base() {
  return applyOp(putAsset(emptyTimeline(), { id: "video", kind: "video", duration: 30000 }), {
    type: "addClip", clip: makeClip({ id: "v", assetId: "video", trackId: "v1", start: 5000, inPoint: 2000, duration: 4000, volume: 0.7 }),
  });
}

it("chooses free A1 at the matching time, allowing adjacent audio", () => {
  const timeline = base();
  expect(planAudioDetach(timeline, "v", [])).toEqual({ kind: "ready", op: { type: "detachAudio", clipId: "v", trackId: "a1" }, trackName: "A1" });
  const adjacent = applyOp(timeline, { type: "addClip", clip: { ...timeline.clips.v!, id: "adjacent", trackId: "a1", start: 9000 } });
  expect(planAudioDetach(adjacent, "v", [])).toMatchObject({ op: { trackId: "a1" } });
});

it("creates a free audio track when existing tracks are occupied or locked", () => {
  const timeline = base();
  const occupied = applyOp(timeline, { type: "addClip", clip: { ...timeline.clips.v!, id: "busy", trackId: "a1" } });
  expect(planAudioDetach(occupied, "v", [])).toMatchObject({ op: { trackId: "a2" } });
  expect(planAudioDetach(timeline, "v", ["a1", "a2"])).toMatchObject({ op: { trackId: "a3" } });
});

it("explains missing selection, locked video, non-video and already detached audio", () => {
  const timeline = base();
  for (const id of [null, "missing"]) expect(planAudioDetach(timeline, id, []).kind).toBe("unavailable");
  expect(planAudioDetach(timeline, "v", ["v1"])).toMatchObject({ kind: "unavailable", reason: expect.stringContaining("Unlock") });
  const detached = applyOp(timeline, { type: "detachAudio", clipId: "v", trackId: "a1" });
  expect(planAudioDetach(detached, "v", [])).toMatchObject({ kind: "unavailable", reason: expect.stringContaining("already") });
  expect(planAudioDetach(detached, "audio:v", []).kind).toBe("unavailable");
});
