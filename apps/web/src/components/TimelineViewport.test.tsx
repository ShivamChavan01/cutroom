import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { clipsOnTrack, emptyTimeline, putAsset, applyOp, makeClip, type FieldConflict } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";
import { useVcsStore } from "../vcsStore";
import { createTimeScale } from "../lib/timeScale";
import { Track } from "./Track";
import { Timeline } from "./Timeline";

vi.mock("../store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store")>();
  return {
    ...actual,
    useEditorStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useEditorStore.getState>) => T) => selector(actual.useEditorStore.getState()),
      { getState: actual.useEditorStore.getState },
    ),
    useClipsOnTrack: (trackId: string) => clipsOnTrack(actual.useEditorStore.getState().timeline, trackId),
    usePlayhead: () => actual.useEditorStore.getState().playheadMs,
    useSelection: () => actual.useEditorStore.getState().selectedClipId,
    useTrackIds: () => actual.useEditorStore.getState().timeline.tracks.map((track) => track.id),
  };
});

vi.mock("../uiStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../uiStore")>();
  return {
    ...actual,
    useUiStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useUiStore.getState>) => T) => selector(actual.useUiStore.getState()),
      { getState: actual.useUiStore.getState, setState: actual.useUiStore.setState },
    ),
  };
});

vi.mock("../vcsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vcsStore")>();
  return {
    ...actual,
    useVcsStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useVcsStore.getState>) => T) => selector(actual.useVcsStore.getState()),
      { getState: actual.useVcsStore.getState, setState: actual.useVcsStore.setState },
    ),
  };
});

function clip(id: string, start: number, duration = 1_000) {
  return makeClip({ id, start, duration, trackId: "v1", assetId: "a", inPoint: 0, volume: 1 });
}

const trackProps = {
  trackId: "v1",
  scale: createTimeScale(50),
  laneWidth: 100_000,
  visibleWindow: { start: 10_000, end: 20_000 },
  pinnedClipIds: [],
  focusedConflictKey: null,
  assetDurations: {},
  diagnosticsByClip: new Map(),
  authors: new Map(),
  diffById: new Map(),
  ghosts: [],
  conflictBands: [],
  conflictGhosts: [],
  mergeResult: null,
  resolveConflict: () => undefined,
} satisfies ComponentProps<typeof Track>;

describe("timeline viewport rendering", () => {
  beforeEach(() => {
    useEditorStore.getState().loadTimeline(emptyTimeline("viewport"));
    useEditorStore.getState().setZoom(50);
    useUiStore.setState({ hiddenTrackIds: [], mutedTrackIds: [], lockedTrackIds: [] });
    useVcsStore.setState({ pending: null, diffOverlay: null });
  });

  it("keeps the full lane width while mounting viewport and pinned clips", () => {
    const clips = [clip("before", 0), clip("span", 0, 30_000), clip("visible", 15_000), clip("pinned", 50_000)];
    useEditorStore.getState().loadTimeline({ ...emptyTimeline(), clips: Object.fromEntries(clips.map((item) => [item.id, item])) });
    const html = renderToStaticMarkup(<Track {...trackProps} pinnedClipIds={["pinned"]} />);
    expect(html).toContain("width:100000px");
    expect(html).toContain('aria-label="clip span"');
    expect(html).toContain('aria-label="clip visible"');
    expect(html).toContain('aria-label="clip pinned"');
    expect(html).not.toContain('aria-label="clip before"');
    expect(html).toContain('data-clip-id="pinned"');
  });

  it("keeps crossing diff links and conflicts while filtering offscreen ghosts", () => {
    const moved = clip("moved", 30_000);
    const inside = clip("inside", 15_000);
    const outside = clip("outside", 40_000);
    const timeline = { ...emptyTimeline(), clips: { moved } };
    useEditorStore.getState().loadTimeline(timeline);
    const conflict: FieldConflict = { kind: "field", clipId: "moved", field: "start", base: 0, ours: 30_000, theirs: 40_000 };
    const html = renderToStaticMarkup(<Track {...trackProps}
      diffById={new Map([["moved", { clipId: "moved", tint: "moved", badge: "moved", linkFromMs: 0 }]])}
      ghosts={[
        { clipId: "inside", tint: "removed", badge: "removed", ghost: inside },
        { clipId: "outside", tint: "removed", badge: "removed", ghost: outside },
      ]}
      conflictGhosts={[{ key: "inside", clip: inside }, { key: "outside", clip: outside }]}
      conflictBands={[
        { key: "crossing", conflict, index: 0, trackId: "v1", start: 0, end: 30_000, label: "Crossing conflict" },
        { key: "outside", conflict, index: 1, trackId: "v1", start: 40_000, end: 50_000, label: "Outside conflict" },
      ]}
      mergeResult={{ merged: timeline, clean: false, conflicts: [conflict], takenFromTheirs: [], deleted: [] }}
    />);
    expect(html).toContain("dashed #74c0fc");
    expect(html).toContain('aria-label="removed clip inside"');
    expect(html).toContain('aria-label="merge candidate inside"');
    expect(html).not.toContain('aria-label="removed clip outside"');
    expect(html).not.toContain('aria-label="merge candidate outside"');
    expect(html).toContain("Crossing conflict");
    expect(html).toContain("Keep ours");
    expect(html).not.toContain("Outside conflict");
  });

  it("keeps only the focused offscreen conflict band until focus moves away", () => {
    const moved = clip("moved", 40_000);
    const timeline = { ...emptyTimeline(), clips: { moved } };
    useEditorStore.getState().loadTimeline(timeline);
    const conflict: FieldConflict = { kind: "field", clipId: "moved", field: "volume", base: 1, ours: 0.5, theirs: 0.25 };
    const conflictBands = [
      { key: "focused", conflict, index: 0, trackId: "v1", start: 40_000, end: 41_000, label: "Focused conflict" },
      { key: "other", conflict, index: 1, trackId: "v1", start: 50_000, end: 51_000, label: "Other conflict" },
    ];
    const mergeResult = { merged: timeline, clean: false, conflicts: [conflict], takenFromTheirs: [], deleted: [] };
    const render = (focusedConflictKey: string | null) => renderToStaticMarkup(<Track {...trackProps}
      focusedConflictKey={focusedConflictKey}
      conflictBands={conflictBands}
      mergeResult={mergeResult}
    />);
    const focused = render("focused");
    expect(focused).toContain('data-conflict-key="focused"');
    expect(focused).toContain("Focused conflict");
    expect(focused).toContain("Keep ours");
    expect(focused).toContain("Take theirs");
    expect(focused).not.toContain("Other conflict");
    expect(focused).not.toContain('aria-label="clip moved"');
    const released = render(null);
    expect(released).not.toContain("Focused conflict");
    expect(released).not.toContain("Other conflict");
    expect(released).not.toContain("Keep ours");
  });

  it("enables detach only for an eligible video selection", () => {
    const base = putAsset(emptyTimeline(), { id: "a", kind: "video", duration: 30000 });
    const timeline = applyOp(base, { type: "addClip", clip: clip("c1", 0) });
    useEditorStore.getState().loadTimeline(timeline);
    const enabled = () => renderToStaticMarkup(<Timeline />).match(/<button[^>]*title="Move sound to A1[^>]*>/);
    expect(enabled()).toBeNull();
    useEditorStore.getState().selectClip("c1");
    expect(enabled()).not.toBeNull();
    expect(enabled()?.[0]).not.toMatch(/\sdisabled=/);
    useUiStore.setState({ lockedTrackIds: ["v1"] });
    expect(enabled()).toBeNull();
  });

  it("bounds the initial timeline DOM and retains an offscreen selection", () => {
    const clips = Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`c${index}`, clip(`c${index}`, index * 2_000)]));
    useEditorStore.getState().loadTimeline({ ...emptyTimeline(), clips });
    useEditorStore.getState().selectClip("c999");
    const html = renderToStaticMarkup(<Timeline />);
    expect(html.match(/class="studio-clip"/g)).toHaveLength(17);
    expect(html).toContain('aria-label="clip c0"');
    expect(html).toContain('aria-label="clip c999"');
    expect(html).not.toContain('aria-label="clip c500"');
    expect(html).toContain('data-timeline-lane="true"');
  });
});
