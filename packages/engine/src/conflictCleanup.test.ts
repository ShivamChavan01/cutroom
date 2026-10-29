import { expect, it } from "vitest";
import { emptyTimeline, makeClip, mergeTimelines, refreshMergeConflicts, resolveField, resolveProject, type MergeResult } from "./index";

function overlapping(count = 3): MergeResult {
  const timeline = { ...emptyTimeline(), clips: Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const id = `c${index}`;
    return [id, makeClip({ id, trackId: "v1", assetId: "asset", start: index * 100, inPoint: 0, duration: 1000, volume: 1 })];
  })) };
  return mergeTimelines(timeline, timeline, timeline);
}

it("rebuilds overlaps from current clip geometry and drops semantic conflicts for absent clips", () => {
  const result = overlapping();
  const { c1: removed, ...clips } = result.merged.clips;
  expect(removed).toBeDefined();
  const next = refreshMergeConflicts({ ...result, merged: { ...result.merged, clips }, conflicts: [...result.conflicts,
    { kind: "field", clipId: "c1", field: "start", base: 0, ours: 100, theirs: 200 },
    { kind: "project", field: "id", base: "base", ours: "ours", theirs: "theirs" },
  ] });
  expect(next.conflicts).toHaveLength(2);
  expect(next.conflicts[0]?.kind).toBe("project");
  expect(next.conflicts[1]).toMatchObject({ kind: "overlap", a: "c0", b: "c2" });
  expect(next.clean).toBe(false);
  expect(result.merged.clips.c1).toBeDefined();
});

it("field resolution refreshes overlap locations and removes pairs that no longer intersect", () => {
  const result = overlapping();
  const conflict: MergeResult = { ...result, conflicts: [...result.conflicts,
    { kind: "field", clipId: "c1", field: "start", base: 0, ours: 100, theirs: 5000 },
  ] };
  const next = resolveField(conflict, "c1", "start", "theirs");
  expect(next.merged.clips.c1?.start).toBe(5000);
  expect(next.conflicts).toHaveLength(1);
  expect(next.conflicts[0]).toMatchObject({ kind: "overlap", a: "c0", b: "c2" });
});

it("project resolution does not accidentally report a capped geometric result as clean", () => {
  const result = overlapping(4);
  const pending: MergeResult = { ...result, conflicts: [
    { kind: "project", field: "id", base: "base", ours: "ours", theirs: "theirs" },
  ] };
  const next = resolveProject(pending, "id", "theirs");
  expect(next.merged.id).toBe("theirs");
  expect(next.conflicts).toHaveLength(6);
  expect(next.clean).toBe(false);
});

it("keeps overlap reporting bounded while retaining a blocking conflict", () => {
  const result = overlapping(40);
  expect(result.conflicts).toHaveLength(200);
  expect(result.clean).toBe(false);
  const next = refreshMergeConflicts(result, { maxOverlapConflicts: 1 });
  expect(next.conflicts).toHaveLength(1);
  expect(next.clean).toBe(false);
  const empty = { ...result, merged: emptyTimeline() };
  expect(refreshMergeConflicts(empty)).toMatchObject({ clean: true, conflicts: [] });
});

it("rejects zero, negative and non-integer reporting caps instead of hiding overlaps", () => {
  const result = overlapping();
  for (const maxOverlapConflicts of [0, -1, NaN, Infinity, 0.5]) {
    expect(() => refreshMergeConflicts(result, { maxOverlapConflicts })).toThrow("positive safe integer");
    expect(() => mergeTimelines(result.merged, result.merged, result.merged, { maxOverlapConflicts })).toThrow("positive safe integer");
  }
});
