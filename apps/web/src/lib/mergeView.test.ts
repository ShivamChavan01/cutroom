import { describe, expect, it } from "vitest";
import {
  type MergeResult,
  type Op,
  type Timeline,
  applyOps,
  emptyTimeline,
  makeClip,
  mergeTimelines,
  putAsset,
  resolveField,
} from "@cutroom/engine";
import { resolveDeleteModify, resolveOverlap } from "./vcs";
import { conflictsToVisuals } from "./mergeView";

function addClips(
  ids: readonly {
    readonly id: string;
    readonly start: number;
    readonly duration?: number;
  }[],
): readonly Op[] {
  return ids.map(({ id, start, duration }) => ({
    type: "addClip",
    clip: makeClip({
      id,
      trackId: "v1",
      assetId: "asset-a",
      start,
      inPoint: 0,
      // The engine's overlap gate compares timeline start against the
      // asset-local outPoint (inPoint + duration), so short clips can only
      // clash near the origin — longer clips there keep the scenario honest.
      duration: duration ?? 2_000,
      volume: 1,
    }),
  }));
}

function timelineWith(
  ids: readonly {
    readonly id: string;
    readonly start: number;
    readonly duration?: number;
  }[],
): Timeline {
  return applyOps(
    putAsset(emptyTimeline("mergeview-test"), {
      id: "asset-a",
      kind: "video",
      duration: 60_000,
    }),
    addClips(ids),
  );
}

describe("mergeView mapping", () => {
  it("leaves project conflicts in the conflict panel without inventing clip bands", () => {
    const base = emptyTimeline("project");
    const ours = { ...base, fps: 25 };
    const result = mergeTimelines(base, ours, { ...base, fps: 24 });
    expect(result.clean).toBe(false);
    const visuals = conflictsToVisuals(result, ours);
    expect(visuals.bandsByTrack.size).toBe(0);
    expect(visuals.ghostsByTrack.size).toBe(0);
  });
  it("spans an overlap band exactly over the clash and ghosts the candidate not already in place", () => {
    const base = timelineWith([{ id: "a", start: 0 }, { id: "b", start: 10_000 }]);
    const theirs = applyOps(base, [{ type: "moveClip", clipId: "b", start: 1_000 }]);
    const merge = mergeTimelines(base, base, theirs);
    const visuals = conflictsToVisuals(merge, base);

    const bands = visuals.bandsByTrack.get("v1") ?? [];
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({
      key: "0:overlap:a",
      index: 0,
      trackId: "v1",
      start: 1_000,
      end: 2_000,
      label: "[overlap] a × b",
    });
    expect(bands[0]?.conflict).toBe(merge.conflicts[0]);

    const ghosts = visuals.ghostsByTrack.get("v1") ?? [];
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ key: "b" });
    expect(ghosts[0]?.clip.start).toBe(1_000);
    expect(visuals.ghostsByTrack.size).toBe(1);
  });

  it("bands a field conflict on the merged clip's bounds and ghosts nothing", () => {
    const base = timelineWith([{ id: "a", start: 0 }]);
    const ours = applyOps(base, [{ type: "setVolume", clipId: "a", volume: 0.5 }]);
    const theirs = applyOps(base, [{ type: "setVolume", clipId: "a", volume: 0.2 }]);
    const merge = mergeTimelines(base, ours, theirs);
    const visuals = conflictsToVisuals(merge, ours);

    const bands = visuals.bandsByTrack.get("v1") ?? [];
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({
      key: "0:field:a",
      trackId: "v1",
      start: 0,
      end: 2_000,
      label: "[field] a.volume",
    });
    expect(visuals.ghostsByTrack.size).toBe(0);
  });

  it("ghosts a delete-modify survivor missing from the working copy", () => {
    const base = timelineWith([{ id: "a", start: 0 }]);
    const ours = applyOps(base, [{ type: "deleteClip", clipId: "a" }]);
    const theirs = applyOps(base, [{ type: "setVolume", clipId: "a", volume: 0.5 }]);
    const merge = mergeTimelines(base, ours, theirs);
    const visuals = conflictsToVisuals(merge, ours);

    const bands = visuals.bandsByTrack.get("v1") ?? [];
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({
      key: "0:deleteModify:a",
      trackId: "v1",
      start: 0,
      end: 2_000,
      label: "[delete-vs-edit] a",
    });
    const ghosts = visuals.ghostsByTrack.get("v1") ?? [];
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ key: "a" });
    expect(ghosts[0]?.clip.volume).toBe(0.5);
  });

  it("keeps a delete-modify survivor already in place to a band alone", () => {
    const base = timelineWith([{ id: "a", start: 0 }]);
    const ours = applyOps(base, [{ type: "setVolume", clipId: "a", volume: 0.5 }]);
    const theirs = applyOps(base, [{ type: "deleteClip", clipId: "a" }]);
    const merge = mergeTimelines(base, ours, theirs);
    const visuals = conflictsToVisuals(merge, ours);

    expect(visuals.bandsByTrack.get("v1")).toHaveLength(1);
    expect(visuals.ghostsByTrack.size).toBe(0);
  });

  it("drops the overlap band and ghost once the overlap is resolved either way", () => {
    const base = timelineWith([{ id: "a", start: 0 }, { id: "b", start: 10_000 }]);
    const theirs = applyOps(base, [{ type: "moveClip", clipId: "b", start: 1_000 }]);
    const merge = mergeTimelines(base, base, theirs);

    const keepA = conflictsToVisuals(resolveOverlap(merge, "a", "b"), base);
    expect(keepA.bandsByTrack.size).toBe(0);
    expect(keepA.ghostsByTrack.size).toBe(0);

    const keepB = conflictsToVisuals(resolveOverlap(merge, "b", "a"), base);
    expect(keepB.bandsByTrack.size).toBe(0);
    expect(keepB.ghostsByTrack.size).toBe(0);
  });

  it("drops the delete-modify band and ghost once resolved either way", () => {
    const base = timelineWith([{ id: "a", start: 0 }]);
    const ours = applyOps(base, [{ type: "deleteClip", clipId: "a" }]);
    const theirs = applyOps(base, [{ type: "setVolume", clipId: "a", volume: 0.5 }]);
    const merge = mergeTimelines(base, ours, theirs);

    const removed = resolveDeleteModify(merge, "a", false);
    expect(removed.clean).toBe(true);
    const removedVisuals = conflictsToVisuals(removed, ours);
    expect(removedVisuals.bandsByTrack.size).toBe(0);
    expect(removedVisuals.ghostsByTrack.size).toBe(0);

    const kept = resolveDeleteModify(merge, "a", true);
    expect(kept.clean).toBe(true);
    const keptVisuals = conflictsToVisuals(kept, ours);
    expect(keptVisuals.bandsByTrack.size).toBe(0);
    expect(keptVisuals.ghostsByTrack.size).toBe(0);
  });

  it("drops the field band once either side is chosen", () => {
    const base = timelineWith([{ id: "a", start: 0 }]);
    const ours = applyOps(base, [{ type: "setVolume", clipId: "a", volume: 0.5 }]);
    const theirs = applyOps(base, [{ type: "setVolume", clipId: "a", volume: 0.2 }]);
    const merge = mergeTimelines(base, ours, theirs);

    const keptOurs = conflictsToVisuals(
      resolveField(merge, "a", "volume", "ours"),
      ours,
    );
    expect(keptOurs.bandsByTrack.size).toBe(0);

    const chosenTheirs = resolveField(merge, "a", "volume", "theirs");
    expect(chosenTheirs.merged.clips["a"]).toMatchObject({ volume: 0.2 });
    const chosenVisuals = conflictsToVisuals(chosenTheirs, ours);
    expect(chosenVisuals.bandsByTrack.size).toBe(0);
  });

  it("maps a clean merge to two empty maps", () => {
    const base = timelineWith([{ id: "a", start: 0 }]);
    const merge = mergeTimelines(base, base, base);
    expect(merge.conflicts).toHaveLength(0);

    const visuals = conflictsToVisuals(merge, base);
    expect(visuals.bandsByTrack.size).toBe(0);
    expect(visuals.ghostsByTrack.size).toBe(0);
  });

  it("renders one band per conflict when two conflicts share a clip", () => {
    const base = timelineWith([{ id: "a", start: 0 }, { id: "b", start: 10_000 }]);
    const ours = applyOps(base, [{ type: "setVolume", clipId: "a", volume: 0.5 }]);
    const theirs = applyOps(base, [
      { type: "setVolume", clipId: "a", volume: 0.2 },
      { type: "moveClip", clipId: "b", start: 1_000 },
    ]);
    const merge = mergeTimelines(base, ours, theirs);
    const visuals = conflictsToVisuals(merge, ours);

    const bands = visuals.bandsByTrack.get("v1") ?? [];
    expect(bands).toHaveLength(2);
    expect(bands.map((band) => band.key)).toEqual(["0:field:a", "1:overlap:a"]);
    expect(bands[1]).toMatchObject({ label: "[overlap] a × b", start: 1_000, end: 2_000 });

    // Ours keeps clip a, so only theirs' moved clip b renders as a ghost.
    expect(visuals.ghostsByTrack.get("v1")).toHaveLength(1);
  });

  it("ghosts both sides of an overlap the working copy does not show", () => {
    const base = timelineWith([
      { id: "a", start: 0, duration: 30_000 },
      { id: "b", start: 10_000, duration: 30_000 },
    ]);
    const theirs = applyOps(base, [
      { type: "moveClip", clipId: "a", start: 10_000 },
      { type: "moveClip", clipId: "b", start: 9_000 },
    ]);
    const merge = mergeTimelines(base, base, theirs);
    const visuals = conflictsToVisuals(merge, base);

    const bands = visuals.bandsByTrack.get("v1") ?? [];
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({
      label: "[overlap] b × a",
      start: 10_000,
      end: 39_000,
    });

    const ghosts = visuals.ghostsByTrack.get("v1") ?? [];
    expect(ghosts.map((ghost) => ghost.key).sort()).toEqual(["a", "b"]);
    expect(
      ghosts.map((ghost) => ghost.clip.start).sort((x, y) => x - y),
    ).toEqual([9_000, 10_000]);
  });

  it("carries the conflict objects by reference so the band can resolve them", () => {
    const base = timelineWith([{ id: "a", start: 0 }, { id: "b", start: 10_000 }]);
    const ours = applyOps(base, [{ type: "setVolume", clipId: "a", volume: 0.5 }]);
    const theirs = applyOps(base, [
      { type: "setVolume", clipId: "a", volume: 0.2 },
      { type: "moveClip", clipId: "b", start: 1_000 },
    ]);
    const merge = mergeTimelines(base, ours, theirs);
    const visuals = conflictsToVisuals(merge, ours);

    const bands = visuals.bandsByTrack.get("v1") ?? [];
    expect(bands[0]?.conflict).toBe(merge.conflicts[0]);
    expect(bands[1]?.conflict).toBe(merge.conflicts[1]);
    expect(bands).toHaveLength(2);
  });
});
