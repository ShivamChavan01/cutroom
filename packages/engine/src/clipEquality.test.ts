import {expect, it} from "vitest";
import {makeClip, sameClip} from "./index";
const clip = makeClip({id: "clip", trackId: "v1", assetId: "source", start: 0, inPoint: 0, duration: 1000, volume: 1});
it("compares all meaningful clip fields using default transform semantics", () => {
  expect(sameClip(clip, {...clip, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0})).toBe(true);
  for (const changed of [{id: "other"}, {trackId: "v2"}, {assetId: "other"}, {start: 1}, {inPoint: 1}, {duration: 999}, {volume: .5}, {x: 1}, {y: 1}, {scaleX: 2}, {scaleY: 2}, {rotation: 1}]) expect(sameClip(clip, {...clip, ...changed})).toBe(false);
});
it("handles absent clips and excludes the derived outPoint cache", () => {
  expect(sameClip(undefined, undefined)).toBe(true); expect(sameClip(clip, undefined)).toBe(false);
  expect(sameClip(undefined, clip)).toBe(false); expect(sameClip(clip, {...clip, outPoint: 999})).toBe(true);
});
