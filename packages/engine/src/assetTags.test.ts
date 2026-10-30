import {expect, it} from "vitest";
import {applyOp, authorsByClip, createHistory, current, emptyTimeline, putAsset, record, undo, redo} from "./index";
const base = putAsset(emptyTimeline(), {id: "source", name: "original.mp4", kind: "video", duration: 2000});
it("replays immutable tag edits with exact undo/redo of absent and cleared tags", () => {
  const tags = ["interview"];
  const op = {type: "setAssetTags", assetId: "source", tags} as const;
  const edited = applyOp(base, op);
  tags.push("mutated-after-dispatch");
  expect(edited.assets.source?.tags).toEqual(["interview"]);
  const h = record(createHistory(base), {type: "setAssetTags", assetId: "source", tags: ["interview"]}, "A");
  expect(current(undo(h))).toEqual(base);
  expect(current(redo(undo(h)))).toEqual(edited);
  expect(authorsByClip(h).size).toBe(0);
  expect(base.assets.source?.tags).toBeUndefined();
  const clear = record(h, {type: "setAssetTags", assetId: "source", tags: []}, "A");
  expect(current(clear).assets.source?.tags).toEqual([]);
  expect(current(undo(clear))).toEqual(edited);
});
it("rejects missing assets and invalid tags, preserving the input", () => {
  expect(() => applyOp(base, {type: "setAssetTags", assetId: "missing", tags: []})).toThrow(/unknown asset/);
  for (const tags of [[""], [" spaced "], ["x".repeat(41)], ["one", "ONE"], Array.from({length:13}, (_, i) => `${i}`)]) {
    expect(() => applyOp(base, {type: "setAssetTags", assetId: "source", tags})).toThrow(/tags/);
  }
  expect(base.assets.source?.tags).toBeUndefined();
});
