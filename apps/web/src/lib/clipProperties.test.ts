import { describe, expect, it } from "vitest";
import { makeClip } from "@cutroom/engine";
import { clipPropertyOp } from "./clipProperties";

const clip = makeClip({ id: "a", trackId: "v1", assetId: "source", start: 0, inPoint: 1_000, duration: 4_000, volume: 1 });
describe("clip property edits", () => {
  it("trims the in-point without moving the out-point", () => {
    expect(clipPropertyOp(clip, "inPoint", 2)).toEqual({ type: "trimClip", clipId: "a", inPoint: 2_000, duration: 3_000 });
  });
  it("converts out-point, start and volume units", () => {
    expect(clipPropertyOp(clip, "outPoint", 3)).toEqual({ type: "trimClip", clipId: "a", duration: 2_000 });
    expect(clipPropertyOp(clip, "start", 1.25)).toEqual({ type: "moveClip", clipId: "a", start: 1_250 });
    expect(clipPropertyOp(clip, "volume", 75)).toEqual({ type: "setVolume", clipId: "a", volume: .75 });
  });
  it("links scale while preserving the existing aspect ratio", () => {
    expect(clipPropertyOp({ ...clip, scaleX: 2, scaleY: 1 }, "scaleX", 300, true))
      .toEqual({ type: "setTransform", clipId: "a", scaleX: 3, scaleY: 1.5 });
    expect(clipPropertyOp(clip, "scaleY", 50)).toEqual({ type: "setTransform", clipId: "a", scaleY: .5 });
  });
  it.each([NaN, Infinity, -Infinity])("rejects non-finite values %s", (value) => {
    expect(() => clipPropertyOp(clip, "x", value)).toThrow("finite");
  });
  it("rejects inverted trims and invalid scales or volume", () => {
    expect(() => clipPropertyOp(clip, "inPoint", 5)).toThrow("precede");
    expect(() => clipPropertyOp(clip, "outPoint", 1)).toThrow("follow");
    expect(() => clipPropertyOp(clip, "scaleX", 0)).toThrow("Scale");
    expect(() => clipPropertyOp(clip, "volume", 101)).toThrow("Volume");
    expect(() => clipPropertyOp(clip, "start", -1)).toThrow("negative");
  });
  it.each(["x", "y", "rotation"] as const)("preserves transform unit %s", (field) => {
    expect(clipPropertyOp(clip, field, 45)).toEqual({ type: "setTransform", clipId: "a", [field]: 45 });
  });
});
