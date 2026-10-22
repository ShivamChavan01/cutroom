import { describe, expect, it } from "vitest";
import {
  type FieldConflict,
  type OverlapConflict,
  type Timeline,
  applyOps,
  diffTimelines,
  emptyTimeline,
  makeClip,
  mergeTimelines,
  putAsset,
  splitChildId,
} from "./index";
import { ASSET_DURATION, baseTimeline, clipOn } from "./fixtures.js";

/**
 * Fork a base into two branches by applying independent op sets.
 *
 * Derived by replaying the ops through the same `applyOp` the app uses, so a
 * test scenario cannot accidentally construct a state the app could never
 * reach.
 */
function fork(base: Timeline): {
  ours: Timeline;
  theirs: Timeline;
} {
  return {
    ours: applyOps(base, []),
    theirs: applyOps(base, []),
  };
}

describe("merge", () => {
  it("converges when both branches split the same clip at the same point", () => {
    const base = baseTimeline();
    const { ours, theirs } = fork(base);

    // Same clip, same frame, two branches. Deterministic child IDs make this
    // an identical result rather than a manufactured conflict.
    const splitAt = 4_000;
    const leftOurs = applyOps(ours, [{ type: "splitClip", clipId: "c1", at: splitAt }]);
    const leftTheirs = applyOps(theirs, [
      { type: "splitClip", clipId: "c1", at: splitAt },
    ]);

    expect(Object.keys(leftOurs.clips).sort()).toEqual(
      Object.keys(leftTheirs.clips).sort(),
    );

    const result = mergeTimelines(base, leftOurs, leftTheirs);

    expect(result.clean).toBe(true);
    expect(Object.keys(result.merged.clips)).toEqual([
      splitChildId("c1", splitAt, "L"),
      splitChildId("c1", splitAt, "R"),
    ]);
    // Children tile the parent exactly: no gap, no overlap, no lost duration.
    const total = Object.values(result.merged.clips).reduce(
      (sum, clip) => sum + clip.duration,
      0,
    );
    expect(total).toBe(10_000);
  });

  it("treats identical edits on the same clip as converged, not conflicting", () => {
    const base = baseTimeline();
    const ours = applyOps(base, [
      { type: "trimClip", clipId: "c1", inPoint: 1_000, duration: 5_000 },
    ]);
    const theirs = applyOps(base, [
      { type: "trimClip", clipId: "c1", inPoint: 1_000, duration: 5_000 },
    ]);

    const result = mergeTimelines(base, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.merged.clips.c1?.inPoint).toBe(1_000);
    expect(result.merged.clips.c1?.duration).toBe(5_000);
  });

  it("takes a one-sided field edit from whichever branch made it", () => {
    const base = baseTimeline();

    // Different fields on the same clip: ours touches inPoint, theirs volume.
    // Neither conflicts because they touch different fields of the same clip.
    const ours = applyOps(base, [
      { type: "trimClip", clipId: "c1", inPoint: 2_000 },
    ]);
    const theirs = applyOps(base, [{ type: "setVolume", clipId: "c1", volume: 0.5 }]);

    const result = mergeTimelines(base, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.merged.clips.c1?.inPoint).toBe(2_000);
    expect(result.merged.clips.c1?.volume).toBe(0.5);
  });

  it("flags a field conflict when both branches edit the same field differently", () => {
    const base = baseTimeline();
    const ours = applyOps(base, [
      { type: "trimClip", clipId: "c1", inPoint: 1_000 },
    ]);
    const theirs = applyOps(base, [
      { type: "trimClip", clipId: "c1", inPoint: 3_000 },
    ]);

    const result = mergeTimelines(base, ours, theirs);
    const fieldConflicts = result.conflicts.filter(
      (c): c is FieldConflict => c.kind === "field",
    );

    expect(result.clean).toBe(false);
    expect(fieldConflicts).toHaveLength(1);
    expect(fieldConflicts[0]?.field).toBe("inPoint");
    expect(fieldConflicts[0]?.ours).toBe(1_000);
    expect(fieldConflicts[0]?.theirs).toBe(3_000);
    // Never invents a third value the user did not pick.
    expect(result.merged.clips.c1?.inPoint).toBe(1_000);
  });

  it("detects an overlap that a per-clip merge alone would miss", () => {
    const base = baseTimeline();

    // Two clips on the same track that do not overlap in the base.
    const withTwo = clipOn(base, "c2", { start: 10_000 });

    // Ours shortens c1 to end at 10s. Theirs pulls c2 back to start at 9s.
    // Neither clip is touched by both branches, so a per-clip merge reports
    // zero conflicts -- yet the merged timeline has c1 and c2 overlapping.
    const ours = applyOps(withTwo, [
      { type: "trimClip", clipId: "c1", duration: 10_000, inPoint: 0 },
    ]);
    const theirs = applyOps(withTwo, [
      { type: "moveClip", clipId: "c2", start: 9_000 },
    ]);

    const fieldConflicts = mergeTimelines(withTwo, ours, theirs).conflicts.filter(
      (c): c is FieldConflict => c.kind === "field",
    );
    // Confirms the premise: pass 1 genuinely sees nothing.
    expect(fieldConflicts).toHaveLength(0);

    const result = mergeTimelines(withTwo, ours, theirs);
    const overlapConflicts = result.conflicts.filter(
      (c): c is OverlapConflict => c.kind === "overlap",
    );

    expect(result.clean).toBe(false);
    expect(overlapConflicts.length).toBeGreaterThan(0);
    const pair = overlapConflicts[0]!;
    expect([pair.a, pair.b].sort()).toEqual(["c1", "c2"]);
    expect(pair.overlapStart).toBe(9_000);
    expect(pair.overlapEnd).toBe(10_000);
  });

  it("detects an overlap away from the origin, where asset-local outPoints mislead", () => {
    // Regression: the overlap sweep once gated on clip.inPoint +
    // clip.duration (the asset-local clock). Two clips clashing at 30s were
    // invisible whenever their source media started at 0.
    const base = applyOps(
      putAsset(emptyTimeline("merge-offorigin"), {
        id: "asset-a",
        kind: "video",
        duration: 900_000,
      }),
      [
        {
          type: "addClip",
          clip: makeClip({
            id: "c1", trackId: "v1", assetId: "asset-a",
            start: 10_000, inPoint: 0, duration: 2_000, volume: 1,
          }),
        },
        {
          type: "addClip",
          clip: makeClip({
            id: "c2", trackId: "v1", assetId: "asset-a",
            start: 30_000, inPoint: 0, duration: 2_000, volume: 1,
          }),
        },
      ],
    );

    // Ours stretches c1 to end at 31s; theirs pulls c2 back to 29.5s.
    // Neither side touches the other's clip, so a per-clip merge sees
    // nothing — the geometric pass must.
    const ours = applyOps(base, [
      { type: "trimClip", clipId: "c1", duration: 21_000 },
    ]);
    const theirs = applyOps(base, [
      { type: "moveClip", clipId: "c2", start: 29_500 },
    ]);

    const result = mergeTimelines(base, ours, theirs);
    const overlapConflicts = result.conflicts.filter(
      (c): c is OverlapConflict => c.kind === "overlap",
    );

    expect(overlapConflicts).toHaveLength(1);
    const pair = overlapConflicts[0]!;
    expect([pair.a, pair.b].sort()).toEqual(["c1", "c2"]);
    expect(pair.overlapStart).toBe(29_500);
    expect(pair.overlapEnd).toBe(31_000);
  });

  it("does not auto-resolve an overlap by shifting a clip", () => {
    const base = baseTimeline();
    const withTwo = clipOn(base, "c2", { start: 10_000 });
    const ours = applyOps(withTwo, [{ type: "trimClip", clipId: "c1", inPoint: 0 }]);
    const theirs = applyOps(withTwo, [{ type: "moveClip", clipId: "c2", start: 2_000 }]);

    const result = mergeTimelines(withTwo, ours, theirs);

    // c2 keeps exactly the position theirs put it at. Retiming someone's edit
    // without asking is the one thing a video editor will not forgive.
    expect(result.merged.clips.c2?.start).toBe(2_000);
    expect(result.conflicts.some((c) => c.kind === "overlap")).toBe(true);
  });

  it("surfaces a delete-vs-modify conflict rather than silently dropping work", () => {
    const base = baseTimeline();
    const ours = applyOps(base, [{ type: "deleteClip", clipId: "c1" }]);
    const theirs = applyOps(base, [
      { type: "trimClip", clipId: "c1", inPoint: 2_000 },
    ]);

    const result = mergeTimelines(base, ours, theirs);
    const conflicts = result.conflicts.filter((c) => c.kind === "deleteModify");

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.oursDeleted).toBe(true);
    expect(conflicts[0]?.theirsDeleted).toBe(false);
    // Kept in the result so the user can see what was nearly lost.
    expect(result.merged.clips.c1).toBeDefined();
  });

  it("honours a one-sided delete with no competing edit", () => {
    const base = clipOn(baseTimeline(), "c2", { start: 10_000 });
    const ours = applyOps(base, [{ type: "deleteClip", clipId: "c2" }]);
    const theirs = applyOps(base, []);

    const result = mergeTimelines(base, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.merged.clips.c2).toBeUndefined();
  });

  it("keeps clips added independently on both branches", () => {
    const base = baseTimeline();
    const ours = clipOn(base, "mine", { start: 12_000 });
    const theirs = clipOn(base, "yours", { start: 14_000 });

    const result = mergeTimelines(base, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.merged.clips.mine).toBeDefined();
    expect(result.merged.clips.yours).toBeDefined();
  });

  it("conflicts rather than silently picking when both sides add different content under one id", () => {
    const base = baseTimeline();
    const ours = clipOn(base, "same-id", { start: 12_000 });
    const theirs = clipOn(base, "same-id", { start: 14_000 });

    const result = mergeTimelines(base, ours, theirs);
    const fieldConflicts = result.conflicts.filter(
      (c): c is FieldConflict => c.kind === "field",
    );

    expect(result.clean).toBe(false);
    expect(fieldConflicts.some((c) => c.field === "start")).toBe(true);
  });

  it("round-trips: merge output diffs clean against either branch's intent", () => {
    const base = baseTimeline();
    const ours = clipOn(base, "c2", { start: 10_000 });
    const theirs = applyOps(base, [
      { type: "trimClip", clipId: "c1", inPoint: 500, duration: 9_500 },
    ]);

    const merged = mergeTimelines(base, ours, theirs).merged;

    // Merged state contains both edits.
    expect(merged.clips.c1?.inPoint).toBe(500);
    expect(merged.clips.c2?.start).toBe(10_000);
    // And diffing base against it shows exactly those two changes.
    const diff = diffTimelines(base, merged);
    expect(diff.added).toBe(1);
    expect(diff.changed).toBe(1);
    expect(diff.removed).toBe(0);
  });

  it("rejects a trim that would run past the end of the source asset", () => {
    const base = baseTimeline();
    expect(() =>
      applyOps(base, [
        { type: "trimClip", clipId: "c1", inPoint: 0, duration: ASSET_DURATION + 1_000 },
      ]),
    ).toThrow(/exceeds asset/);
  });

  it("rejects a clip whose declared outPoint disagrees with its own fields", () => {
    const base = baseTimeline();
    // A hand-built clip with an inconsistent outPoint must never enter the
    // timeline: it would silently corrupt every geometric check downstream.
    const bad = {
      id: "bad",
      trackId: "v1",
      assetId: "asset-a",
      start: 0,
      inPoint: 0,
      duration: 1_000,
      volume: 1,
      outPoint: 9_999,
    };
    expect(() => applyOps(base, [{ type: "addClip", clip: bad }])).toThrow(
      /malformed/,
    );
  });
});
