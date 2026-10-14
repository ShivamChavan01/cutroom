import { emptyTimeline, makeClip, putAsset } from "@cutroom/engine";
import { registerAssetUrl } from "./assets";
import { useEditorStore } from "../store";

/**
 * Editor actions shared by keyboard shortcuts, transport bar and inspector.
 * All mutations go through the store (which goes through the engine) —
 * components never touch history directly.
 */

export function seedTestClips(): void {
  const { dispatch, loadTimeline } = useEditorStore.getState();
  let base = emptyTimeline("demo");
  base = putAsset(base, { id: "asset-a", kind: "video", duration: 60_000 });
  base = putAsset(base, { id: "asset-b", kind: "video", duration: 60_000 });
  loadTimeline(base);
  registerAssetUrl("asset-a", "/test-a.mp4");
  registerAssetUrl("asset-b", "/test-b.mp4");
  const clips = [
    { id: "a", start: 0, duration: 4_000, assetId: "asset-a" },
    { id: "b", start: 4_000, duration: 3_000, assetId: "asset-b" },
    { id: "c", start: 9_000, duration: 5_000, assetId: "asset-a" },
    { id: "narr", start: 1_000, duration: 6_000, assetId: "asset-a", trackId: "a1" },
  ];
  for (const { id, start, duration, assetId, trackId } of clips) {
    dispatch({
      type: "addClip",
      clip: makeClip({
        id,
        trackId: trackId ?? "v1",
        assetId,
        start,
        inPoint: 0,
        duration,
        volume: 1,
      }),
    });
  }
}

/** Dev-only: force an overlap the linter must flag. */
export function seedOverlap(): void {
  const { dispatch } = useEditorStore.getState();
  dispatch({
    type: "addClip",
    clip: makeClip({
      id: "overlap-demo",
      trackId: "v1",
      assetId: "asset-a",
      start: 2_000,
      inPoint: 0,
      duration: 2_000,
      volume: 1,
    }),
  });
}

export function splitAtPlayhead(): boolean {
  const { timeline, selectedClipId, playheadMs, dispatch } =
    useEditorStore.getState();
  if (selectedClipId === null) return false;
  const clip = timeline.clips[selectedClipId];
  if (clip === undefined) return false;
  // Engine op takes a clip-local offset; the UI thinks in timeline time.
  const at = playheadMs - clip.start;
  if (at <= 0 || at >= clip.duration) return false;
  dispatch({ type: "splitClip", clipId: selectedClipId, at });
  return true;
}

export function deleteSelected(): boolean {
  const { selectedClipId, dispatch, selectClip } = useEditorStore.getState();
  if (selectedClipId === null) return false;
  dispatch({ type: "deleteClip", clipId: selectedClipId });
  selectClip(null);
  return true;
}

export function canSplitAtPlayhead(): boolean {
  const { timeline, selectedClipId, playheadMs } = useEditorStore.getState();
  if (selectedClipId === null) return false;
  const clip = timeline.clips[selectedClipId];
  if (clip === undefined) return false;
  return playheadMs > clip.start && playheadMs < clip.start + clip.duration;
}
