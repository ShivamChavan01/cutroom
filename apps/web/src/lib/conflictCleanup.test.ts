import { expect, it } from "vitest";
import { emptyTimeline, makeClip, mergeTimelines, type MergeResult } from "@cutroom/engine";
import { resolveDeleteModify, resolveOverlap } from "./vcs";

function overlapping(ids = ["a", "b", "c"]): MergeResult {
  const timeline = { ...emptyTimeline(), clips: Object.fromEntries(ids.map((id, index) => [id, makeClip({
    id, trackId: "v1", assetId: "asset", start: index * 100, inPoint: 0, duration: 1000, volume: 1,
  })])) };
  return mergeTimelines(timeline, timeline, timeline);
}

it("removes every overlap involving a deleted clip while retaining the remaining pair", () => {
  const result = overlapping();
  const next = resolveOverlap(result, "a", "b");
  expect(next.merged.clips.b).toBeUndefined();
  expect(next.conflicts).toEqual([{ kind: "overlap", trackId: "v1", a: "a", b: "c", overlapStart: 200, overlapEnd: 1000 }]);
  expect(next.clean).toBe(false);
  expect(resolveOverlap(next, "a", "c").clean).toBe(true);
  expect(Object.keys(result.merged.clips)).toEqual(["a", "b", "c"]);
});

it("delete-modify removal drops stale clip conflicts but preserves unrelated choices", () => {
  const result = overlapping();
  const annotated: MergeResult = { ...result, conflicts: [...result.conflicts,
    { kind: "deleteModify", clipId: "b", oursDeleted: true, theirsDeleted: false, survivor: result.merged.clips.b! },
    { kind: "field", clipId: "b", field: "volume", base: 1, ours: 0.5, theirs: 0.2 },
    { kind: "field", clipId: "a", field: "volume", base: 1, ours: 0.5, theirs: 0.2 },
    { kind: "project", field: "id", base: "base", ours: "ours", theirs: "theirs" },
  ] };
  const next = resolveDeleteModify(annotated, "b", false);
  expect(next.conflicts.filter((conflict) => "clipId" in conflict && conflict.clipId === "b")).toEqual([]);
  expect(next.conflicts.filter((conflict) => conflict.kind === "overlap")).toHaveLength(1);
  expect(next.conflicts.some((conflict) => conflict.kind === "field" && conflict.clipId === "a")).toBe(true);
  expect(next.conflicts.some((conflict) => conflict.kind === "project")).toBe(true);
  expect(next.clean).toBe(false);
  const kept = resolveDeleteModify(annotated, "b", true);
  expect(kept.merged.clips.b).toBeDefined();
  expect(kept.conflicts.filter((conflict) => conflict.kind === "overlap")).toHaveLength(3);
  expect(kept.conflicts.some((conflict) => conflict.kind === "field" && conflict.clipId === "b")).toBe(true);
});

it("discovers previously capped overlaps as earlier pairs are resolved", () => {
  const result = overlapping(["a", "b", "c", "d"]);
  const capped: MergeResult = { ...result, conflicts: result.conflicts.slice(0, 1) };
  const next = resolveOverlap(capped, "a", "b");
  expect(next.conflicts.filter((conflict) => conflict.kind === "overlap")).toHaveLength(3);
  expect(next.clean).toBe(false);
});

it("ignores stale or unrelated resolution requests rather than deleting arbitrary clips", () => {
  const result = overlapping();
  expect(resolveOverlap(result, "a", "missing")).toBe(result);
  expect(resolveOverlap(result, "a", "a")).toBe(result);
  expect(resolveDeleteModify(result, "a", false)).toBe(result);
});

it("sequential overlap resolutions are idempotent and preserve timing in either order", () => {
  const result = overlapping();
  const first = resolveOverlap(resolveOverlap(result, "a", "b"), "a", "c");
  const second = resolveOverlap(resolveOverlap(result, "a", "c"), "a", "b");
  expect(first).toEqual(second);
  expect(first.clean).toBe(true);
  expect(first.merged.clips.a).toEqual(result.merged.clips.a);
  expect(resolveOverlap(first, "a", "b")).toBe(first);
});

it.each(["missing keeper", "no longer overlapping", "different tracks"])("does not delete a surviving clip from a stale listed pair: %s", scenario => {
  const result = overlapping(["a", "b"]);
  const clips = { ...result.merged.clips };
  if (scenario === "missing keeper") delete clips.a;
  if (scenario === "no longer overlapping") clips.a = { ...clips.a!, start: 5000 };
  if (scenario === "different tracks") clips.a = { ...clips.a!, trackId: "a1" };
  const stale = { ...result, merged: { ...result.merged, clips } };
  const settled = resolveOverlap(stale, "a", "b");
  expect(settled.merged.clips.b).toEqual(clips.b);
  expect(settled.merged.clips).toEqual(clips);
  expect(settled.conflicts).toEqual([]);
  expect(settled.clean).toBe(true);
});
