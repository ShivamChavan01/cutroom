import { beforeEach, describe, expect, it } from "vitest";
import { emptyTimeline, makeClip, putAsset } from "@cutroom/engine";
import { useEditorStore } from "./store";

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
    seed();
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
});
