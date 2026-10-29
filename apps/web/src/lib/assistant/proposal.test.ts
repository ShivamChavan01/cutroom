import { describe, expect, it } from "vitest";
import { emptyTimeline, makeClip, putAsset } from "@cutroom/engine";
import { assistantContext, parsePlan, previewPlan } from "./proposal";

function fixture() {
  const base = putAsset(emptyTimeline("assistant"), { id: "asset", kind: "video", duration: 10_000, name: "Interview.mp4" });
  return { ...base, clips: { c1: makeClip({ id: "c1", trackId: "v1", assetId: "asset", start: 1000, inPoint: 0, duration: 5000, volume: 1 }) } };
}

describe("AI proposals", () => {
  it("previews a real edit and verification without mutating the source", () => {
    const before = fixture();
    const proposal = previewPlan(before, parsePlan({ summary: "Move and quieten", ops: [
      { type: "moveClip", clipId: "c1", start: 0 }, { type: "setVolume", clipId: "c1", volume: 0.4 },
    ] }), []);
    expect(before.clips.c1.start).toBe(1000);
    expect(proposal.after.clips.c1?.start).toBe(0);
    expect(proposal.after.clips.c1?.volume).toBe(0.4);
    expect(proposal.diff.changed).toBe(1);
  });
  it.each([
    null, {}, { summary: "", ops: [] }, { summary: "x", ops: null },
    { summary: "x", ops: Array.from({ length: 51 }, () => ({ type: "deleteClip", clipId: "c1" })) },
    { summary: "x", ops: [{ type: "eval", clipId: "c1" }] },
    { summary: "x", ops: [{ type: "setVolume", clipId: "c1", volume: 2 }] },
    { summary: "x", ops: [{ type: "moveClip", clipId: "c1", start: NaN }] },
    { summary: "x", ops: [{ type: "trimClip", clipId: "c1", duration: 0 }] },
    { summary: "x", ops: [{ type: "trimClip", clipId: "c1" }] },
    { summary: "x", ops: [{ type: "setTransform", clipId: "c1" }] },
    { summary: "x", ops: [{ type: "setTransform", clipId: "c1", scaleX: 0 }] },
    { summary: "x", ops: [{ type: "deleteClip", clipId: "c1", extra: true }] },
  ])("rejects malformed or unsupported plans: %j", (input) => expect(() => parsePlan(input)).toThrow());
  it("accepts empty plans for explanations and all supported operations", () => {
    expect(parsePlan({ summary: "Please select a clip", ops: [] }).ops).toEqual([]);
    for (const op of [
      { type: "deleteClip", clipId: "c1" }, { type: "splitClip", clipId: "c1", at: 2000 },
      { type: "trimClip", clipId: "c1", inPoint: 500, duration: 3000 },
      { type: "moveClip", clipId: "c1", start: 0, trackId: "v1" },
      { type: "setTransform", clipId: "c1", x: -10, y: 0, scaleX: 2, scaleY: 1, rotation: 90 },
    ]) expect(previewPlan(fixture(), parsePlan({ summary: "Edit", ops: [op] }), []).diff.changes.length).toBeGreaterThan(0);
  });
  it("rejects locked tracks, missing clips and impossible source trims", () => {
    const plan = (op: unknown) => parsePlan({ summary: "Edit", ops: [op] });
    expect(() => previewPlan(fixture(), plan({ type: "deleteClip", clipId: "c1" }), ["v1"])).toThrow("locked");
    expect(() => previewPlan(fixture(), plan({ type: "moveClip", clipId: "c1", start: 0, trackId: "a1" }), ["a1"])).toThrow("locked");
    expect(() => previewPlan(fixture(), plan({ type: "deleteClip", clipId: "missing" }), [])).toThrow();
    expect(() => previewPlan(fixture(), plan({ type: "deleteClip", clipId: "__proto__" }), [])).toThrow("does not exist");
    expect(() => previewPlan(fixture(), plan({ type: "trimClip", clipId: "c1", duration: 11_000 }), [])).toThrow();
  });
  it("sends metadata and issues, with selection, playhead and locks; bounds context", () => {
    const context = assistantContext(fixture(), "c1", 1234, ["v1"]);
    expect(context).toContain('"selectedClipId":"c1"');
    expect(context).toContain('"playheadMs":1234');
    expect(context).toContain("Interview.mp4");
    expect(context).not.toContain("blob:");
    expect(() => assistantContext({ ...fixture(), clips: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [String(i), fixture().clips.c1])) }, null, 0, [])).toThrow("1,000");
    expect(() => assistantContext({ ...fixture(), tracks: [{ id: "v1", name: "x".repeat(250_001), kind: "video", muted: false }] }, null, 0, [])).toThrow("too large");
  });
});


it("enforces destination locks for a detach op passed to proposal preview", () => {
  expect(() => previewPlan(fixture(), { summary: "detach", ops: [{ type: "detachAudio", clipId: "c1", trackId: "a1" }] }, ["a1"])).toThrow("locked");
});
