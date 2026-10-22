import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";
import { deleteMedia } from "./media/opfs";
import { isAssetReferenced } from "./media/references";

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
  dispatch({ type: "deleteClip", clipId: selectedClipId });
  selectClip(null);
  if (clip !== undefined) {
    // The file may only go when nothing points at it any more: no clip in
    // the working timeline and no clip in any commit's snapshot.
    const { timeline } = useEditorStore.getState();
    const { repo } = useVcsStore.getState();
    if (!isAssetReferenced(clip.assetId, timeline, repo?.commits ?? {})) {
      void deleteMedia(clip.assetId);
    }
  }
  return true;
}

export function canSplitAtPlayhead(): boolean {
  const { timeline, selectedClipId, playheadMs } = useEditorStore.getState();
  if (selectedClipId === null) return false;
  const clip = timeline.clips[selectedClipId];
  if (clip === undefined) return false;
  return playheadMs > clip.start && playheadMs < clip.start + clip.duration;
}
