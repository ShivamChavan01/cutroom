import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";

/**
 * Editor actions shared by keyboard shortcuts, transport bar and inspector.
 * All mutations go through the store (which goes through the engine) —
 * components never touch history directly.
 */

export function splitAtPlayhead(): boolean {
  const { timeline, selectedClipId, playheadMs, dispatch } =
    useEditorStore.getState();
  if (selectedClipId === null) return false;
  const clip = timeline.clips[selectedClipId];
  if (clip === undefined) return false;
  if (useUiStore.getState().lockedTrackIds.includes(clip.trackId)) return false;
  // Engine op takes a clip-local offset; the UI thinks in timeline time.
  const at = playheadMs - clip.start;
  if (at <= 0 || at >= clip.duration) return false;
  dispatch({ type: "splitClip", clipId: selectedClipId, at });
  return true;
}

export function deleteSelected(): boolean {
  const { selectedClipId, dispatch, selectClip } = useEditorStore.getState();
  if (selectedClipId === null) return false;
  const clip = useEditorStore.getState().timeline.clips[selectedClipId];
  if (clip !== undefined && useUiStore.getState().lockedTrackIds.includes(clip.trackId)) return false;
  dispatch({ type: "deleteClip", clipId: selectedClipId });
  selectClip(null);
  // Removing a clip keeps its source: Undo, the media bin and saved cuts may need it.
  return true;
}

export function canSplitAtPlayhead(): boolean {
  const { timeline, selectedClipId, playheadMs } = useEditorStore.getState();
  if (selectedClipId === null) return false;
  const clip = timeline.clips[selectedClipId];
  if (clip === undefined) return false;
  if (useUiStore.getState().lockedTrackIds.includes(clip.trackId)) return false;
  return playheadMs > clip.start && playheadMs < clip.start + clip.duration;
}
