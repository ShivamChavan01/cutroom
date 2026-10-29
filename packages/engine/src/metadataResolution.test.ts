import { expect, it } from "vitest";
import { conflictKey, emptyTimeline, makeClip, mergeTimelines, resolveMetadata, type MetadataConflict, type Timeline } from "./index";
function metadata() {
  const base: Timeline = { ...emptyTimeline(), assets: { a: { id: "a", name: "base", duration: 10000, kind: "video" } } };
  const ours = { ...base, assets: { a: { ...base.assets.a!, name: "ours" } }, tracks: base.tracks.map(t => ({ ...t, name: "ours" })) };
  const theirs = { ...base, assets: { a: { ...base.assets.a!, name: "theirs" } }, tracks: base.tracks.map(t => ({ ...t, name: "theirs" })) };
  return { base, ours, theirs };
}
it("resolves fields individually, retains unrelated conflicts, and ignores repeated requests", () => {
  const { base, ours, theirs } = metadata();
  const result = mergeTimelines(base, ours, theirs);
  expect(result.conflicts).toHaveLength(3);
  let next = result;
  for (const c of result.conflicts) {
    if (c.kind !== "assetField" && c.kind !== "trackField") throw new Error("Unexpected fixture conflict");
    next = resolveMetadata(next, c, "theirs");
    expect(resolveMetadata(next, c, "ours")).toBe(next);
  }
  expect(next.clean).toBe(true);
  expect(next.merged).toEqual(theirs);
  expect(result.clean).toBe(false);
  expect(new Set(result.conflicts.map(conflictKey)).size).toBe(3);
});
it("resolution order produces the same snapshot and conflict set", () => {
  const { base, ours, theirs } = metadata();
  const r = mergeTimelines(base, ours, theirs);
  const choices = r.conflicts.filter((c): c is MetadataConflict => c.kind === "assetField" || c.kind === "trackField");
  const forward = choices.reduce((r, c) => resolveMetadata(r, c, "theirs"), r);
  const reverse = [...choices].reverse().reduce((r, c) => resolveMetadata(r, c, "theirs"), r);
  expect(reverse).toEqual(forward);
});
it.each(["asset", "track"] as const)("requires references to be removed before deleting %s metadata", kind => {
  const { base } = metadata();
  const clip = makeClip({ id: "clip", assetId: "a", trackId: "v1", start: 0, inPoint: 0, duration: 1000, volume: 1 });
  const ours = kind === "asset" ? { ...base, assets: {} } : { ...base, tracks: base.tracks.slice(1) };
  const r = mergeTimelines(base, ours, { ...base, clips: { clip } });
  const c = r.conflicts.find((c): c is MetadataConflict => c.kind === "assetPresence" || c.kind === "trackPresence");
  if (c === undefined) throw new Error("Missing presence conflict");
  expect(() => resolveMetadata(r, c, "ours")).toThrow(/referencing clips/);
  const kept = resolveMetadata(r, c, "keep");
  expect(kept.clean).toBe(true);
  expect(kept.merged.clips.clip).toEqual(clip);
  const withoutClip = { ...r, merged: { ...r.merged, clips: {} } };
  const removed = resolveMetadata(withoutClip, c, "ours");
  expect(removed.clean).toBe(true);
  if (kind === "asset") expect(removed.merged.assets.a).toBeUndefined();
  else expect(removed.merged.tracks.some(t => t.id === "v1")).toBe(false);
});
it("resolves divergent existing track orders without inventing tracks", () => {
  const b = { ...emptyTimeline(), tracks: [...emptyTimeline().tracks, { id: "v2", kind: "video" as const, name: "V2", muted: false }] };
  const [a, c, d] = b.tracks;
  if (!a || !c || !d) throw new Error("fixture");
  const o = { ...b, tracks: [c, a, d] }, t = { ...b, tracks: [a, d, c] };
  const r = mergeTimelines(b, o, t);
  const conflict = r.conflicts.find(c => c.kind === "trackOrder");
  if (conflict?.kind !== "trackOrder") throw new Error("Missing order conflict");
  expect(resolveMetadata(r, conflict, "theirs").merged.tracks).toEqual(t.tracks);
});
it("concurrent identical additions converge and independent tracks retain clip references", () => {
  const b = emptyTimeline();
  const asset = { id: "a", kind: "video" as const, duration: 2000 };
  const v2 = { id: "v2", kind: "video" as const, name: "V2", muted: false };
  const v3 = { ...v2, id: "v3", name: "V3" };
  const clip = makeClip({ id: "c", trackId: "v3", assetId: "a", start: 0, inPoint: 0, duration: 1000, volume: 1 });
  const o = { ...b, assets: { a: asset }, tracks: [...b.tracks, v2] };
  expect(mergeTimelines(b, o, o).clean).toBe(true);
  const r = mergeTimelines(b, o, { ...b, assets: { a: asset }, tracks: [...b.tracks, v3], clips: { c: clip } });
  expect(r.clean).toBe(true);
  expect(r.merged.tracks.map(t => t.id)).toEqual(["v1", "a1", "v2", "v3"]);
  expect(r.merged.tracks.some(t => t.id === r.merged.clips.c?.trackId)).toBe(true);
});
it("preserves independently added tracks when resolving an existing layer-order disagreement", () => {
  const b = { ...emptyTimeline(), tracks: [...emptyTimeline().tracks, { id: "v2", kind: "video" as const, name: "V2", muted: false }] };
  const [v1, a1, v2] = b.tracks;
  if (!v1 || !a1 || !v2) throw new Error("fixture");
  const left = { ...v1, id: "left", name: "Left" };
  const right = { ...v1, id: "right", name: "Right" };
  const ours = { ...b, tracks: [a1, v1, v2, left] };
  const theirs = { ...b, tracks: [v1, v2, a1, right] };
  const result = mergeTimelines(b, ours, theirs);
  const conflict = result.conflicts.find(c => c.kind === "trackOrder");
  if (conflict?.kind !== "trackOrder") throw new Error("Missing track order conflict");
  const resolved = resolveMetadata(result, conflict, "theirs");
  expect(resolved.clean).toBe(true);
  expect(resolved.merged.tracks.map(t => t.id)).toEqual(["v1", "v2", "a1", "right", "left"]);
  expect(new Set(resolved.merged.tracks.map(t => t.id)).size).toBe(5);
  expect(resolveMetadata(resolved, conflict, "ours")).toBe(resolved);
});
it.each([false, true])("refreshes layer-order disagreement after a track deletion (remaining disagreement: %s)", divergent => {
  const tracks = ["a", "b", "c", "d"].map(id => ({ id, kind: "video" as const, name: id, muted: false }));
  const [a, b, c, d] = tracks;
  if (!a || !b || !c || !d) throw new Error("fixture");
  const base = { ...emptyTimeline(), tracks };
  const ours = { ...base, tracks: [c, b, d] };
  const theirs = { ...base, tracks: divergent ? [{ ...a, name: "Renamed" }, d, c, b] : [{ ...a, name: "Renamed" }, c, b, d] };
  const result = mergeTimelines(base, ours, theirs);
  const presence = result.conflicts.find(c => c.kind === "trackPresence");
  const order = result.conflicts.find(c => c.kind === "trackOrder");
  if (presence?.kind !== "trackPresence" || order?.kind !== "trackOrder") throw new Error("Missing fixture conflicts");
  const resolved = resolveMetadata(result, presence, "ours");
  expect(resolved.merged.tracks.map(t => t.id)).toEqual(["c", "b", "d"]);
  expect(resolved.clean).toBe(!divergent);
  expect(resolved.conflicts).toEqual(divergent ? [order] : []);
  if (divergent) {
    const chosen = resolveMetadata(resolved, order, "theirs");
    expect(chosen.clean).toBe(true);
    expect(chosen.merged.tracks.map(t => t.id)).toEqual(["d", "c", "b"]);
  }
});
it("retains independent appended layers while refreshing an order conflict after deletion", () => {
  const track = (id: string) => ({ id, kind: "video" as const, name: id, muted: false });
  const a = track("a"), b = track("b"), c = track("c"), left = track("left"), right = track("right");
  const base = { ...emptyTimeline(), tracks: [a, b, c] };
  const result = mergeTimelines(base, { ...base, tracks: [c, b, left] }, { ...base, tracks: [{ ...a, name: "Renamed" }, b, c, right] });
  const presence = result.conflicts.find(c => c.kind === "trackPresence");
  if (presence?.kind !== "trackPresence") throw new Error("Missing presence conflict");
  const removed = resolveMetadata(result, presence, "ours");
  const order = removed.conflicts.find(c => c.kind === "trackOrder");
  if (order?.kind !== "trackOrder") throw new Error("Lost meaningful order conflict");
  const resolved = resolveMetadata(removed, order, "theirs");
  expect(resolved.clean).toBe(true);
  expect(resolved.merged.tracks.map(t => t.id)).toEqual(["b", "c", "right", "left"]);
});
