import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline, makeClip, putAsset, record, splitChildId } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { Inspector } from "./Inspector";

vi.mock("../store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store")>();
  return {
    ...actual,
    useEditorStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useEditorStore.getState>) => T) =>
        selector(actual.useEditorStore.getState()),
      { getState: actual.useEditorStore.getState },
    ),
    useSelection: () => actual.useEditorStore.getState().selectedClipId,
  };
});

function seedClip() {
  useEditorStore.getState().loadTimeline(putAsset(emptyTimeline("inspector-test"), {
    id: "asset-video-source", kind: "video", duration: 10_000,
  }));
  useEditorStore.getState().dispatch({
    type: "addClip",
    clip: makeClip({
      id: "clip-1", trackId: "v1", assetId: "asset-video-source",
      start: 1_000, inPoint: 500, duration: 3_000, volume: 0.75,
    }),
  });
  useEditorStore.getState().selectClip("clip-1");
}

describe("clip inspector", () => {
  beforeEach(() => {
    useEditorStore.getState().loadTimeline(emptyTimeline("inspector-test"));
  });

  it("shows a compact selection prompt without unavailable actions", () => {
    const html = renderToStaticMarkup(<Inspector />);
    expect(html).toContain("Clip properties");
    expect(html).toContain("No clip selected");
    expect(html).not.toContain("Split at playhead");
    expect(html).not.toContain("Delete selected clip");
  });

  it("groups the selected clip's actual timing, audio and source values", () => {
    seedClip();
    const html = renderToStaticMarkup(<Inspector />);
    expect(html).toContain("clip-1");
    expect(html).toContain('aria-label="Clip timing"');
    expect(html).toContain('aria-label="Clip audio"');
    expect(html).toContain('aria-label="Source media"');
    expect(html).toContain("0:01.00");
    expect(html).toContain("0:03.00");
    expect(html).toContain("0:00.50");
    expect(html).toContain("0:03.50");
    expect(html).toContain("75%");
    expect(html).toContain(useEditorStore.getState().authorId);
  });

  it("keeps selected split authorship correct through undo, redo and checkout", () => {
    seedClip();
    const store = useEditorStore.getState();
    const beforeSplit = store.timeline;
    const history = record(store.history, { type: "splitClip", clipId: "clip-1", at: 1_000 }, "Split reviewer");
    store.restoreHistory(history);
    store.selectClip(splitChildId("clip-1", 1_000, "L"));
    expect(renderToStaticMarkup(<Inspector />)).toContain("Split reviewer");
    store.undo();
    expect(renderToStaticMarkup(<Inspector />)).toContain("No clip selected");
    store.redo();
    expect(renderToStaticMarkup(<Inspector />)).toContain("Split reviewer");
    store.loadTimeline(beforeSplit);
    store.selectClip("clip-1");
    const checkedOut = renderToStaticMarkup(<Inspector />);
    expect(checkedOut).toContain("Clip timing");
    expect(checkedOut).not.toContain("Split reviewer");
  });

  it.each([0, 1_000, 4_000, 5_000])("disables split outside the clip interior at %s", (at) => {
    seedClip();
    useEditorStore.getState().setPlayhead(at);
    const html = renderToStaticMarkup(<Inspector />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Split at playhead \(S\)"/);
    expect(html).toContain("Place the playhead inside this clip to split.");
  });

  it("enables split when the playhead is inside the selected clip", () => {
    seedClip();
    useEditorStore.getState().setPlayhead(2_000);
    const html = renderToStaticMarkup(<Inspector />);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*title="Split at playhead \(S\)"/);
    expect(html).not.toContain("Place the playhead inside this clip to split.");
  });

  it("handles a stale selected id as an empty selection", () => {
    useEditorStore.getState().selectClip("missing");
    expect(renderToStaticMarkup(<Inspector />)).toContain("No clip selected");
  });

  it("keeps diagnostics for the selected clip visible", () => {
    seedClip();
    useEditorStore.getState().dispatch({
      type: "addClip",
      clip: makeClip({
        id: "clip-2", trackId: "v1", assetId: "asset-video-source",
        start: 2_000, inPoint: 0, duration: 3_000, volume: 1,
      }),
    });
    const html = renderToStaticMarkup(<Inspector />);
    expect(html).toContain('aria-label="Clip issues"');
    expect(html).toContain("overlap");
  });
});
