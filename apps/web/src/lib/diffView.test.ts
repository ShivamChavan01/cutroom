import { describe, expect, it } from "vitest";
import {
  type Timeline,
  applyOps,
  diffTimelines,
  emptyTimeline,
  makeClip,
  putAsset,
} from "@cutroom/engine";
import { changeToVisual, diffToVisuals } from "./diffView";

function timelineWith(ids: readonly { id: string; start: number }[]): Timeline {
  let t = emptyTimeline("diffview-test");
  t = putAsset(t, { id: "asset-a", kind: "video", duration: 60_000 });
  return applyOps(
    t,
    ids.map(({ id, start }) => ({
      type: "addClip" as const,
      clip: makeClip({
        id, trackId: "v1", assetId: "asset-a",
        start, inPoint: 0, duration: 2_000, volume: 1,
      }),
    })),
  );
}

describe("diffView mapping", () => {
  it("tints an added clip with a text cue", () => {
    const diff = diffTimelines(timelineWith([{ id: "a", start: 0 }]), timelineWith([
      { id: "a", start: 0 },
      { id: "b", start: 5_000 },
    ]));
    const visuals = diffToVisuals(diff);

    expect(visuals.byId.get("b")).toMatchObject({ tint: "added", badge: "+ added" });
    expect(visuals.ghostsByTrack.size).toBe(0);
  });

  it("renders a removed clip as a ghost carrying the old clip", () => {
    const diff = diffTimelines(
      timelineWith([{ id: "a", start: 0 }, { id: "b", start: 10_000 }]),
      timelineWith([{ id: "a", start: 0 }]),
    );
    const visuals = diffToVisuals(diff);

    const ghost = visuals.ghostsByTrack.get("v1")?.[0];
    expect(ghost?.tint).toBe("removed");
    expect(ghost?.badge).toBe("− removed");
    expect(ghost?.ghost?.start).toBe(10_000);
    expect(visuals.byId.has("b")).toBe(false);
  });

  it("links a moved clip from its old position with direction and distance", () => {
    const base = timelineWith([{ id: "a", start: 0 }]);
    const moved = applyOps(base, [{ type: "moveClip", clipId: "a", start: 5_000 }]);
    const diff = diffTimelines(base, moved);
    const visual = changeToVisual(diff.changes[0]!);

    expect(visual.tint).toBe("moved");
    expect(visual.badge).toBe("moved → 5.0s");
    expect(visual.linkFromMs).toBe(0);
  });

  it("points the arrow backwards for leftward moves", () => {
    const base = timelineWith([{ id: "a", start: 10_000 }]);
    const moved = applyOps(base, [{ type: "moveClip", clipId: "a", start: 8_000 }]);
    const diff = diffTimelines(base, moved);

    expect(changeToVisual(diff.changes[0]!).badge).toBe("moved ← 2.0s");
  });

  it("labels trims with in-point and duration deltas", () => {
    const base = timelineWith([{ id: "a", start: 0 }]);
    const trimmed = applyOps(base, [
      { type: "trimClip", clipId: "a", inPoint: 1_000, duration: 500 },
    ]);
    const diff = diffTimelines(base, trimmed);

    expect(changeToVisual(diff.changes[0]!)).toMatchObject({
      tint: "trimmed",
      badge: "trimmed in 1.0s, dur -1.5s",
    });
  });

  it("names the changed fields for edited clips", () => {
    const base = timelineWith([{ id: "a", start: 0 }]);
    const edited = applyOps(base, [{ type: "setVolume", clipId: "a", volume: 0.5 }]);
    const diff = diffTimelines(base, edited);

    expect(changeToVisual(diff.changes[0]!)).toMatchObject({
      tint: "edited",
      badge: "~ volume",
    });
  });
});
