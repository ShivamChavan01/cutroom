import { expect, it } from "vitest";
import { emptyTimeline, makeClip, mergeTimelines, resolveField, resolveMetadata, type Timeline } from "./index";

function references() {
  const assets = Object.fromEntries(["a", "b", "c"].map(id => [id, { id, kind: "video" as const, duration: 10000 }]));
  const tracks = ["a", "b", "c"].map(id => ({ id, kind: "video" as const, name: id, muted: false }));
  const clip = makeClip({ id: "clip", assetId: "c", trackId: "c", start: 0, inPoint: 0, duration: 1000, volume: 1 });
  const base: Timeline = { ...emptyTimeline(), assets, tracks, clips: { clip } };
  return { base, clip };
}

it.each(["assetId", "trackId"] as const)("preserves metadata for either unresolved %s choice", field => {
  const { base, clip } = references();
  const ours = { ...base, clips: { clip: { ...clip, [field]: "a" } }, ...(field === "assetId" ? { assets: { a: base.assets.a!, c: base.assets.c! } } : { tracks: base.tracks.filter(t => t.id !== "b") }) };
  const theirs = { ...base, clips: { clip: { ...clip, [field]: "b" } }, ...(field === "assetId" ? { assets: { b: base.assets.b!, c: base.assets.c! } } : { tracks: base.tracks.filter(t => t.id !== "a") }) };
  const original = JSON.stringify([base, ours, theirs]);
  const result = mergeTimelines(base, ours, theirs);
  const missingChoice = result.conflicts.find(c => field === "assetId" ? c.kind === "assetPresence" && c.assetId === "b" : c.kind === "trackPresence" && c.trackId === "b");
  if (missingChoice?.kind !== "assetPresence" && missingChoice?.kind !== "trackPresence") throw new Error("Missing presence conflict for unresolved reference");
  expect(() => resolveMetadata(result, missingChoice, "ours")).toThrow(/referencing clips|unresolved/);
  // Keeping the candidate first and choosing the clip first are both safe.
  const keptFirst = resolveField(resolveMetadata(result, missingChoice, "keep"), "clip", field, "theirs");
  const chosenFirst = resolveMetadata(resolveField(result, "clip", field, "theirs"), missingChoice, "keep");
  expect(keptFirst).toEqual(chosenFirst);
  let resolved = chosenFirst;
  for (const conflict of chosenFirst.conflicts) {
    if (conflict.kind === "assetPresence" || conflict.kind === "trackPresence") resolved = resolveMetadata(resolved, conflict, "theirs");
  }
  expect(resolved.clean).toBe(true);
  expect(resolved.merged.assets[resolved.merged.clips.clip!.assetId]).toBeDefined();
  expect(resolved.merged.tracks.some(t => t.id === resolved.merged.clips.clip!.trackId)).toBe(true);
  expect(JSON.stringify([base, ours, theirs])).toBe(original);
  expect(mergeTimelines(base, ours, theirs)).toEqual(result);
});

it.each(["assetId", "trackId"] as const)("allows deleting an unused %s candidate after the clip choice", field => {
  const { base, clip } = references();
  const ours = { ...base, clips: { clip: { ...clip, [field]: "a" } }, ...(field === "assetId" ? { assets: { a: base.assets.a!, c: base.assets.c! } } : { tracks: base.tracks.filter(t => t.id !== "b") }) };
  const theirs = { ...base, clips: { clip: { ...clip, [field]: "b" } } };
  const result = mergeTimelines(base, ours, theirs);
  const candidate = result.conflicts.find(c => field === "assetId" ? c.kind === "assetPresence" && c.assetId === "b" : c.kind === "trackPresence" && c.trackId === "b");
  if (candidate?.kind !== "assetPresence" && candidate?.kind !== "trackPresence") throw new Error("Missing presence conflict");
  const chosen = resolveField(result, "clip", field, "ours");
  expect(resolveField(chosen, "clip", field, "theirs")).toBe(chosen);
  const removed = resolveMetadata(chosen, candidate, "ours");
  expect(removed.clean).toBe(true);
  expect(removed.merged.clips.clip).toEqual(ours.clips.clip);
  if (field === "assetId") expect(removed.merged.assets.b).toBeUndefined();
  else expect(removed.merged.tracks.some(t => t.id === "b")).toBe(false);
});
