import { beforeEach, describe, expect, it } from "vitest";
import {
  applyOps,
  emptyTimeline,
  makeClip,
  putAsset,
  type Timeline,
} from "@cutroom/engine";
import { closeGapsOps } from "./closeGaps";
import { parseCommand } from "./commands";
import { useEditorStore } from "../store";

function timeline(): Timeline {
  let t = emptyTimeline("commands-test");
  t = putAsset(t, { id: "asset-a", kind: "video", duration: 60_000 });
  return t;
}

function clip(id: string, start: number, duration = 2_000) {
  return {
    type: "addClip" as const,
    clip: makeClip({
      id, trackId: "v1", assetId: "asset-a",
      start, inPoint: 0, duration, volume: 1,
    }),
  };
}

describe("closeGapsOps", () => {
  it("pulls clips left against the cursor, one op per moved clip", () => {
    const t = applyOps(timeline(), [clip("a", 0), clip("b", 5_000), clip("c", 9_000)]);
    const ops = closeGapsOps(t);

    expect(ops).toHaveLength(2);
    const moved = applyOps(t, ops);
    expect(moved.clips.b?.start).toBe(2_000);
    expect(moved.clips.c?.start).toBe(4_000);
  });

  it("returns no ops for an already-tight lane", () => {
    const t = applyOps(timeline(), [clip("a", 0), clip("b", 2_000)]);
    expect(closeGapsOps(t)).toEqual([]);
  });
});

describe("parseCommand", () => {
  beforeEach(() => {
    useEditorStore.getState().loadTimeline(timeline());
  });

  const ctx = () => {
    const store = useEditorStore.getState();
    return {
      timeline: store.timeline,
      selectedClipId: store.selectedClipId,
      playheadMs: store.playheadMs,
    };
  };

  it("splits the selected clip at the playhead", () => {
    const store = useEditorStore.getState();
    store.dispatch(clip("a", 0, 4_000));
    store.selectClip("a");
    store.setPlayhead(1_000);

    const result = parseCommand("split here", ctx());
    expect(result.ok).toBe(true);
    if (result.ok) result.run();
    expect(Object.keys(useEditorStore.getState().timeline.clips)).toHaveLength(2);
  });

  it("splits at an explicit time", () => {
    const store = useEditorStore.getState();
    store.dispatch(clip("a", 0, 4_000));
    store.selectClip("a");

    const result = parseCommand("split at 2s", ctx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      result.run();
      expect(result.message).toBe("split a");
    }
  });

  it("refuses split without a selection or outside the clip", () => {
    expect(parseCommand("split", ctx()).ok).toBe(false);
    const store = useEditorStore.getState();
    store.dispatch(clip("a", 0, 4_000));
    store.selectClip("a");
    store.setPlayhead(9_000);
    expect(parseCommand("split", ctx()).ok).toBe(false);
  });

  it("deletes by id, moves the playhead, closes gaps end to end", () => {
    const store = useEditorStore.getState();
    store.dispatch(clip("a", 0));
    store.dispatch(clip("b", 5_000));

    const del = parseCommand("delete b", ctx());
    expect(del.ok).toBe(true);
    if (del.ok) del.run();
    expect(useEditorStore.getState().timeline.clips.b).toBeUndefined();

    const go = parseCommand("goto 1:30", ctx());
    expect(go.ok).toBe(true);
    if (go.ok) {
      go.run();
      expect(useEditorStore.getState().playheadMs).toBe(90_000);
    }

    const gaps = parseCommand("close gaps", ctx());
    expect(gaps.ok).toBe(true);
    if (gaps.ok) {
      gaps.run();
      expect(gaps.message).toBe("no gaps");
    }
  });

  it("errors inline with the grammar on unknown input", () => {
    const result = parseCommand("make it cinematic", ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("split");
    expect(parseCommand("goto yesterday", ctx()).ok).toBe(false);
  });

  it("zooms and toggles transport", () => {
    const before = useEditorStore.getState().pxPerSecond;
    const result = parseCommand("zoom in", ctx());
    expect(result.ok).toBe(true);
    if (result.ok) result.run();
    expect(useEditorStore.getState().pxPerSecond).toBeGreaterThan(before);
  });
});
