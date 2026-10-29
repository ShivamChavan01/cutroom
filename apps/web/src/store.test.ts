import { beforeEach, describe, expect, it } from "vitest";
import { current, emptyTimeline, makeClip, putAsset, type Op } from "@cutroom/engine";
import { useEditorStore } from "./store";
import { indexedClipsOnTrack } from "./lib/clipIndex";
import { useUiStore } from "./uiStore";

function seed() {
  let t = emptyTimeline("store-test");
  t = putAsset(t, { id: "asset-a", kind: "video", duration: 30_000 });
  useEditorStore.getState().loadTimeline(t);
  return t;
}

function testClip() {
  return makeClip({
    id: "c1",
    trackId: "v1",
    assetId: "asset-a",
    start: 0,
    inPoint: 0,
    duration: 5_000,
    volume: 1,
  });
}

describe("editor store", () => {
  beforeEach(() => {
    useUiStore.setState({ lockedTrackIds: [] });
    seed();
  });

  it("applies a reviewed proposal atomically and preserves normal undo, redo and replay", () => {
    const store = useEditorStore.getState();
    store.dispatch({ type: "addClip", clip: testClip() });
    const before = useEditorStore.getState().timeline;
    const states: unknown[] = [];
    const stop = useEditorStore.subscribe((state) => states.push(state.timeline));
    store.applyProposal(before, [{ type: "moveClip", clipId: "c1", start: 2000 }, { type: "setVolume", clipId: "c1", volume: 0.5 }]);
    stop();
    expect(states).toHaveLength(1);
    expect(current(useEditorStore.getState().history)).toEqual(useEditorStore.getState().timeline);
    store.undo();
    expect(useEditorStore.getState().timeline.clips.c1?.volume).toBe(1);
    store.undo();
    expect(useEditorStore.getState().timeline).toEqual(before);
    store.redo();
    expect(useEditorStore.getState().timeline.clips.c1?.start).toBe(2000);
  });

  it("rejects stale, locked and partially invalid proposals without publishing any edits", () => {
    const store = useEditorStore.getState();
    store.dispatch({ type: "addClip", clip: testClip() });
    const before = useEditorStore.getState().timeline;
    const history = useEditorStore.getState().history;
    expect(() => store.applyProposal(before, [{ type: "moveClip", clipId: "c1", start: 2000 }, { type: "trimClip", clipId: "c1", duration: 90_000 }])).toThrow();
    expect(useEditorStore.getState().timeline).toBe(before);
    expect(useEditorStore.getState().history).toBe(history);
    useUiStore.setState({ lockedTrackIds: ["v1"] });
    expect(() => store.applyProposal(before, [{ type: "deleteClip", clipId: "c1" }])).toThrow("locked");
    useUiStore.setState({ lockedTrackIds: [] });
    store.dispatch({ type: "setVolume", clipId: "c1", volume: 0.7 });
    expect(() => store.applyProposal(before, [{ type: "deleteClip", clipId: "c1" }])).toThrow("timeline changed");
    expect(useEditorStore.getState().timeline.clips.c1).toBeDefined();
  });

  it("dispatches an addClip through the engine and derives the timeline", () => {
    useEditorStore.getState().dispatch({ type: "addClip", clip: testClip() });

    const { timeline } = useEditorStore.getState();
    expect(timeline.clips.c1?.duration).toBe(5_000);
  });

  it("undo reverts the last dispatch and redo restores it", () => {
    const store = useEditorStore.getState();
    store.dispatch({ type: "addClip", clip: testClip() });
    expect(useEditorStore.getState().timeline.clips.c1).toBeDefined();

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().timeline.clips.c1).toBeUndefined();

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().timeline.clips.c1?.duration).toBe(5_000);
  });

  it("stamps the local author on the op log", () => {
    const { authorId } = useEditorStore.getState();
    expect(authorId.length).toBeGreaterThan(0);

    useEditorStore.getState().dispatch({ type: "addClip", clip: testClip() });

    const { history } = useEditorStore.getState();
    expect(history.log[history.log.length - 1]?.author).toBe(authorId);
  });

  it("clamps the playhead at zero and zoom to a sane range", () => {
    const store = useEditorStore.getState();
    store.setPlayhead(-500);
    expect(useEditorStore.getState().playheadMs).toBe(0);

    store.setZoom(10_000);
    expect(useEditorStore.getState().pxPerSecond).toBe(400);
    store.setZoom(0);
    expect(useEditorStore.getState().pxPerSecond).toBe(5);
  });

  it("reads ordered track clips through playback ticks, edits and undo", () => {
    const read = () => indexedClipsOnTrack(useEditorStore.getState().timeline, "v1")
      .map((clip) => clip.id).join(",");
    const store = useEditorStore.getState();
    expect(read()).toBe("");
    store.dispatch({ type: "addClip", clip: testClip() });
    store.dispatch({ type: "addClip", clip: { ...testClip(), id: "earlier", start: 8_000 } });
    expect(read()).toBe("c1,earlier");
    store.setPlayhead(2_000);
    expect(read()).toBe("c1,earlier");
    store.dispatch({ type: "moveClip", clipId: "c1", start: 10_000 });
    expect(read()).toBe("earlier,c1");
    store.undo();
    expect(read()).toBe("c1,earlier");
    store.loadTimeline(emptyTimeline("another-branch"));
    expect(read()).toBe("");
  });

  it("matches canonical replay after mixed incremental edits", () => {
    const operations: readonly Op[] = [
      { type: "addClip", clip: testClip() },
      { type: "addClip", clip: { ...testClip(), id: "c2", start: 8_000 } },
      { type: "addTrack", track: { id: "v2", kind: "video", name: "Video 2", muted: false } },
      { type: "moveClip", clipId: "c1", start: 1_000, trackId: "v2" },
      { type: "trimClip", clipId: "c2", inPoint: 500, duration: 2_500 },
      { type: "setVolume", clipId: "c1", volume: 0.25 },
      { type: "setTransform", clipId: "c2", x: 20, rotation: 45 },
      { type: "renameProject", name: "Edited project" },
      { type: "setFrameRate", fps: 24 },
      { type: "splitClip", clipId: "c1", at: 2_000 },
      { type: "deleteClip", clipId: "c1" },
    ];
    for (const op of operations) {
      useEditorStore.getState().dispatch(op);
      const { history, timeline } = useEditorStore.getState();
      expect(timeline).toEqual(current(history));
      expect(history.log.at(-1)?.seq).toBe(history.cursor - 1);
    }
  });

  it("keeps replay equivalence through cursor changes, restore and new assets", () => {
    const store = useEditorStore.getState();
    const expectReplay = () => {
      const { history, timeline } = useEditorStore.getState();
      expect(timeline).toEqual(current(history));
    };
    store.dispatch({ type: "addClip", clip: testClip() });
    store.dispatch({ type: "moveClip", clipId: "c1", start: 3_000 });
    store.dispatch({ type: "setVolume", clipId: "c1", volume: 0.25 });
    const saved = useEditorStore.getState().history;
    store.undo();
    expectReplay();
    store.redo();
    expectReplay();
    store.undo();
    store.dispatch({ type: "setTransform", clipId: "c1", x: 10 });
    expectReplay();
    expect(useEditorStore.getState().history.log.at(-1)?.op.type).toBe("setTransform");
    expect(useEditorStore.getState().timeline.clips.c1?.volume).toBe(1);
    store.redo();
    expectReplay();
    expect(useEditorStore.getState().timeline.clips.c1?.volume).toBe(1);
    store.restoreHistory(saved);
    expectReplay();
    expect(useEditorStore.getState().timeline.clips.c1?.volume).toBe(0.25);
    store.addAsset({ id: "asset-b", kind: "video", duration: 10_000 });
    store.dispatch({ type: "addClip", clip: { ...testClip(), id: "b", assetId: "asset-b" } });
    expectReplay();
    expect(useEditorStore.getState().timeline.assets["asset-b"]?.duration).toBe(10_000);
    const branch = { ...useEditorStore.getState().timeline, id: "branch" };
    store.loadTimeline(branch);
    store.dispatch({ type: "moveClip", clipId: "b", start: 9_000 });
    expectReplay();
    expect(branch.clips.b?.start).toBe(0);
  });

  it("does not publish either timeline or history when an edit fails", () => {
    const store = useEditorStore.getState();
    store.dispatch({ type: "addClip", clip: testClip() });
    store.dispatch({ type: "moveClip", clipId: "c1", start: 2_000 });
    store.undo();
    const before = useEditorStore.getState();
    const invalid: readonly Op[] = [
      { type: "trimClip", clipId: "c1", duration: 0 },
      { type: "moveClip", clipId: "missing", start: 0 },
      { type: "setVolume", clipId: "c1", volume: Number.NaN },
      { type: "addClip", clip: testClip() },
    ];
    for (const op of invalid) {
      expect(() => store.dispatch(op)).toThrow();
      expect(useEditorStore.getState()).toBe(before);
      expect(useEditorStore.getState().history).toBe(before.history);
      expect(useEditorStore.getState().timeline).toBe(before.timeline);
    }
    useUiStore.setState({ lockedTrackIds: ["v1"] });
    expect(() => store.dispatch({ type: "setVolume", clipId: "c1", volume: 0.5 })).toThrow("locked");
    expect(useEditorStore.getState()).toBe(before);
    useUiStore.setState({ lockedTrackIds: [] });
    store.redo();
    expect(useEditorStore.getState().timeline.clips.c1?.start).toBe(2_000);
  });

  it("preserves a previously edited clip reference while another clip changes", () => {
    const store = useEditorStore.getState();
    store.dispatch({ type: "addClip", clip: testClip() });
    store.dispatch({ type: "addClip", clip: { ...testClip(), id: "c2", start: 8_000 } });
    store.dispatch({ type: "setVolume", clipId: "c1", volume: 0.25 });
    const before = useEditorStore.getState().timeline;
    store.dispatch({ type: "moveClip", clipId: "c2", start: 9_000 });
    const after = useEditorStore.getState().timeline;
    expect(after.clips.c1).toBe(before.clips.c1);
    expect(after.clips.c2).not.toBe(before.clips.c2);
    expect(before.clips.c2?.start).toBe(8_000);
    expect(after).toEqual(current(useEditorStore.getState().history));
  });
});


it("detaches in one store update and one undo, enforcing source and destination locks", () => {
  useUiStore.setState({ lockedTrackIds: [] });
  seed();
  const store = useEditorStore.getState();
  store.dispatch({ type: "addClip", clip: { ...testClip(), volume: 0.6 } });
  const before = useEditorStore.getState().timeline;
  for (const trackId of ["v1", "a1"]) {
    useUiStore.setState({ lockedTrackIds: [trackId] });
    expect(() => store.dispatch({ type: "detachAudio", clipId: "c1", trackId: "a1" })).toThrow("locked");
    expect(useEditorStore.getState().timeline).toBe(before);
  }
  useUiStore.setState({ lockedTrackIds: [] });
  const states: unknown[] = [];
  const stop = useEditorStore.subscribe((state) => states.push(state.timeline));
  store.dispatch({ type: "detachAudio", clipId: "c1", trackId: "a1" });
  stop();
  expect(states).toHaveLength(1);
  const after = useEditorStore.getState().timeline;
  expect(after.clips["audio:c1"]?.volume).toBe(0.6);
  expect(current(useEditorStore.getState().history)).toEqual(after);
  store.undo();
  expect(useEditorStore.getState().timeline).toEqual(before);
  store.redo();
  expect(useEditorStore.getState().timeline).toEqual(after);
});
