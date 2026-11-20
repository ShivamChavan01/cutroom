import {expect, it} from "vitest";
import {applyOp, assetById, emptyTimeline, mergeTimelines, putAsset, resolveMetadata} from "./index";

it.each(["offline-source", "constructor", "toString", "__proto__", "hasOwnProperty"])("returns undefined only for absent own asset %s", id => {
  const base = emptyTimeline("lookup");
  expect(assetById(base, id)).toBeUndefined();
  const asset = {id, kind: "video", duration: 1000} as const;
  const timeline = putAsset(base, asset);
  expect(assetById(timeline, id)).toEqual(asset);
  expect(assetById(base, id)).toBeUndefined();
  expect(applyOp(timeline, {type: "setAssetTags", assetId: id, tags: ["retained"]}).assets[id]?.tags).toEqual(["retained"]);
  expect(() => applyOp(base, {type: "setAssetTags", assetId: id, tags: ["phantom"]})).toThrow(/unknown asset/);
});

it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("preserves own asset %s when introduced by either merged branch", id => {
  const base = emptyTimeline("merge lookup");
  const added = putAsset(base, {id, kind: "video", duration: 1000, name: "Owned media"});
  for (const [ours, theirs] of [[added, base], [base, added]] as const) {
    const result = mergeTimelines(base, ours, theirs);
    expect(result.clean).toBe(true);
    expect(Object.hasOwn(result.merged.assets, id)).toBe(true);
    expect(assetById(result.merged, id)).toEqual(assetById(added, id));
  }
  expect(Object.hasOwn(base.assets, id)).toBe(false);
});

it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("resolves metadata edits and deletion for own asset %s", id => {
  const base = putAsset(emptyTimeline("metadata resolution"), {id, kind: "video", duration: 1000, name: "Original"});
  const ours = putAsset(base, {id, kind: "video", duration: 1000, name: "Ours"});
  const theirs = putAsset(base, {id, kind: "video", duration: 1000, name: "Theirs"});
  const fields = mergeTimelines(base, ours, theirs);
  const field = fields.conflicts.find(conflict => conflict.kind === "assetField");
  if (field === undefined) throw new Error("Expected an explicit metadata field conflict");
  const resolved = resolveMetadata(fields, field, "theirs");
  expect(resolved.clean).toBe(true);
  expect(assetById(resolved.merged, id)).toEqual(assetById(theirs, id));
  const presence = mergeTimelines(base, {...base, assets: {}}, theirs);
  const conflict = presence.conflicts.find(entry => entry.kind === "assetPresence");
  if (conflict === undefined) throw new Error("Expected an explicit deletion-versus-modification conflict");
  expect(assetById(resolveMetadata(presence, conflict, "theirs").merged, id)).toEqual(assetById(theirs, id));
  const removed = resolveMetadata(presence, conflict, "ours");
  expect(removed.clean).toBe(true);
  expect(assetById(removed.merged, id)).toBeUndefined();
  expect(Object.hasOwn(removed.merged.assets, id)).toBe(false);
});
