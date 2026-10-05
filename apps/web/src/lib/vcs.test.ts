import { describe, expect, it } from "vitest";
import {
  applyOps,
  emptyTimeline,
  makeClip,
  mergeTimelines,
  putAsset,
} from "@cutroom/engine";
import {
  ancestors,
  branchHistory,
  checkout,
  commit,
  createBranch,
  createRepo,
  findMergeBase,
  head,
  resolveDeleteModify,
  resolveOverlap,
} from "./vcs";

function timelineWithClip(id: string, start: number) {
  let t = emptyTimeline("vcs-test");
  t = putAsset(t, { id: "asset-a", kind: "video", duration: 30_000 });
  return applyOps(t, [
    {
      type: "addClip",
      clip: makeClip({
        id, trackId: "v1", assetId: "asset-a",
        start, inPoint: 0, duration: 2_000, volume: 1,
      }),
    },
  ]);
}

describe("vcs", () => {
  it("commits move the current branch head", () => {
    let repo = createRepo(timelineWithClip("a", 0), "alice");
    repo = commit(repo, timelineWithClip("a", 0), "second", "alice");

    expect(head(repo).message).toBe("second");
    expect(branchHistory(repo).map((c) => c.id)).toEqual(["c1", "c0"]);
  });

  it("branches fork from the current head and check out independently", () => {
    let repo = createRepo(timelineWithClip("a", 0), "alice");
    repo = createBranch(repo, "feature");
    repo = checkout(repo, "feature");
    repo = commit(repo, timelineWithClip("b", 5_000), "on feature", "bob");

    expect(head(repo, "feature").message).toBe("on feature");
    expect(head(repo, "main").id).toBe("c0");
  });

  it("finds the nearest common ancestor of forked branches", () => {
    let repo = createRepo(timelineWithClip("a", 0), "alice");
    repo = createBranch(repo, "feature");
    repo = commit(repo, timelineWithClip("a", 1_000), "main work", "alice");
    repo = checkout(repo, "feature");
    repo = commit(repo, timelineWithClip("a", 2_000), "feature work", "bob");

    const base = findMergeBase(repo, head(repo, "main").id, head(repo, "feature").id);
    expect(base?.id).toBe("c0");
  });

  it("merges clean branches and records two parents", () => {
    let repo = createRepo(timelineWithClip("a", 0), "alice");
    repo = createBranch(repo, "feature");
    const mainTimeline = applyOps(head(repo, "main").timeline, [
      { type: "moveClip", clipId: "a", start: 1_000 },
    ]);
    repo = commit(repo, mainTimeline, "main work", "alice");
    repo = checkout(repo, "feature");
    const featureTimeline = applyOps(head(repo, "feature").timeline, [
      { type: "setVolume", clipId: "a", volume: 0.5 },
    ]);

    const base = findMergeBase(repo, head(repo, "main").id, head(repo, "feature").id)!;
    const result = mergeTimelines(base.timeline, mainTimeline, featureTimeline);
    expect(result.clean).toBe(true);

    repo = checkout(repo, "main");
    repo = commit(repo, result.merged, "merge feature", "alice", [
      head(repo, "main").id,
      head(repo, "feature").id,
    ]);
    expect(head(repo).parents).toHaveLength(2);
  });

  it("lists all ancestors across merges", () => {
    let repo = createRepo(timelineWithClip("a", 0), "alice");
    repo = commit(repo, timelineWithClip("a", 0), "second", "alice");
    expect(ancestors(repo, head(repo).id).sort()).toEqual(["c0", "c1"]);
  });

  it("settles delete-modify by keeping or removing the survivor", () => {
    const base = timelineWithClip("a", 0);
    const deleted = applyOps(base, [{ type: "deleteClip", clipId: "a" }]);
    const edited = applyOps(base, [
      { type: "trimClip", clipId: "a", inPoint: 500 },
    ]);
    const result = mergeTimelines(base, deleted, edited);
    expect(result.conflicts.some((c) => c.kind === "deleteModify")).toBe(true);

    const kept = resolveDeleteModify(result, "a", true);
    expect(kept.merged.clips.a).toBeDefined();
    expect(kept.conflicts.some((c) => c.kind === "deleteModify")).toBe(false);

    const dropped = resolveDeleteModify(result, "a", false);
    expect(dropped.merged.clips.a).toBeUndefined();
  });

  it("settles overlaps by removing one side plus its field conflicts", () => {
    const base = timelineWithClip("a", 0);
    const withTwo = applyOps(base, [
      {
        type: "addClip",
        clip: makeClip({
          id: "b", trackId: "v1", assetId: "asset-a",
          start: 10_000, inPoint: 0, duration: 2_000, volume: 1,
        }),
      },
    ]);
    const moved = applyOps(withTwo, [{ type: "moveClip", clipId: "b", start: 1_000 }]);
    // b is in the base here, so the move merges as a move — and collides.
    const result = mergeTimelines(withTwo, withTwo, moved);
    expect(result.conflicts.some((c) => c.kind === "overlap")).toBe(true);

    const settled = resolveOverlap(result, "a", "b");
    expect(settled.merged.clips.b).toBeUndefined();
    expect(settled.merged.clips.a).toBeDefined();
    expect(settled.conflicts.some((c) => c.kind === "overlap")).toBe(false);
  });
});
