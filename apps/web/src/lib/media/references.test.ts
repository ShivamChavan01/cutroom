import { describe, expect, it } from "vitest";
import {
  type Timeline,
  applyOps,
  emptyTimeline,
  makeClip,
  putAsset,
} from "@cutroom/engine";
import type { Commit } from "../vcs";
import {
  countAssetReferences,
  isAssetReferenced,
  unreferencedAssets,
} from "./references";

function timelineWith(assetId: string, clipId: string, start = 0): Timeline {
  let t = emptyTimeline("refs");
  t = putAsset(t, { id: assetId, kind: "video", duration: 30_000 });
  return applyOps(t, [
    {
      type: "addClip",
      clip: makeClip({
        id: clipId, trackId: "v1", assetId,
        start, inPoint: 0, duration: 2_000, volume: 1,
      }),
    },
  ]);
}

function commitWith(assetId: string, clipId: string): Commit {
  return {
    id: "c1",
    message: "m",
    author: "alice",
    at: 0,
    timeline: timelineWith(assetId, clipId),
    parents: [],
  };
}

describe("asset reference counting", () => {
  it("counts a clip in the current timeline", () => {
    const t = timelineWith("asset-a", "a");
    const refs = countAssetReferences("asset-a", t);

    expect(refs.clips).toBe(1);
    expect(refs.commits).toBe(0);
    expect(refs.total).toBe(1);
  });

  it("counts a commit that still holds a clip using the asset", () => {
    const t = timelineWith("asset-a", "a");
    const commits = { c1: commitWith("asset-a", "a") };
    const refs = countAssetReferences("asset-a", t, commits);

    expect(refs.clips).toBe(1);
    expect(refs.commits).toBe(1);
    expect(refs.total).toBe(2);
  });

  it("keeps an asset alive when only a commit references it", () => {
    // The clip was deleted from the working timeline, but a commit still
    // has it — the file must not be deleted.
    const t = emptyTimeline("refs");
    const commits = { c1: commitWith("asset-a", "a") };

    expect(isAssetReferenced("asset-a", t, commits)).toBe(true);
    expect(countAssetReferences("asset-a", t, commits).clips).toBe(0);
  });

  it("treats an asset in the registry with no clip as unreferenced", () => {
    let t = emptyTimeline("refs");
    t = putAsset(t, { id: "asset-lonely", kind: "video", duration: 1_000 });

    expect(isAssetReferenced("asset-lonely", t)).toBe(false);
  });

  it("lists unreferenced assets across the timeline and every commit", () => {
    const t = timelineWith("asset-used", "a");
    const commits = {
      c1: {
        ...commitWith("asset-in-commit", "b"),
        timeline: timelineWith("asset-in-commit", "b"),
      },
    };
    let withLonely = t;
    withLonely = putAsset(withLonely, {
      id: "asset-lonely", kind: "video", duration: 1_000,
    });

    const unreferenced = unreferencedAssets(withLonely, commits);
    expect(unreferenced).toContain("asset-lonely");
    expect(unreferenced).not.toContain("asset-used");
    expect(unreferenced).not.toContain("asset-in-commit");
  });

  it("counts two clips using the same asset separately", () => {
    const t = applyOps(timelineWith("asset-a", "a"), [
      {
        type: "addClip",
        clip: makeClip({
          id: "b", trackId: "v1", assetId: "asset-a",
          start: 5_000, inPoint: 0, duration: 2_000, volume: 1,
        }),
      },
    ]);

    expect(countAssetReferences("asset-a", t).clips).toBe(2);
    expect(isAssetReferenced("asset-a", t)).toBe(true);
  });
});
