import { type Clip, clipsOnTrack } from "@cutroom/engine";
import { closeGapsOps } from "./closeGaps";
import { nextCut, previousCut } from "./timecode";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";

export interface PaletteAction {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly run: () => void;
  readonly enabled?: () => boolean;
}

/** Subsequence match: "clg" matches "close gaps". Empty query matches all. */
export function filterActions(actions: readonly PaletteAction[], query: string): PaletteAction[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...actions];
  return actions.filter((action) => {
    const label = action.label.toLowerCase();
    let i = 0;
    for (const ch of label) {
      if (ch === q[i]) i++;
      if (i === q.length) return true;
    }
    return false;
  });
}

/** Every action the palette offers. All real — each one dispatches store ops. */
export function buildActions(): PaletteAction[] {
  const state = () => useEditorStore.getState();
  const videoClips = (): readonly Clip[] => {
    const timeline = state().timeline;
    const trackId =
      timeline.tracks.find((track) => track.kind === "video")?.id ?? "v1";
    return clipsOnTrack(timeline, trackId);
  };
  return [
    {
      id: "play-pause",
      label: "Play / Pause",
      hint: "Space",
      run: () => {
        const s = state();
        if (s.isPlaying) s.pause();
        else s.play();
      },
    },
    {
      id: "next-cut",
      label: "Jump to next cut",
      run: () => {
        const cuts = videoClips().map((clip) => ({ start: clip.start }));
        const target = nextCut(cuts, state().playheadMs);
        if (target !== null) state().setPlayhead(target);
      },
    },
    {
      id: "previous-cut",
      label: "Jump to previous cut",
      run: () => {
        const cuts = videoClips().map((clip) => ({ start: clip.start }));
        const target = previousCut(cuts, state().playheadMs);
        if (target !== null) state().setPlayhead(target);
      },
    },
    {
      id: "show-issues",
      label: "Show issues panel",
      run: () => {
        useUiStore.getState().setBottomTab("issues");
        useUiStore.getState().setRail("issues");
      },
    },
    {
      id: "show-activity",
      label: "Show activity panel",
      run: () => useUiStore.getState().setBottomTab("activity"),
    },
    {
      id: "show-timeline",
      label: "Show timeline",
      run: () => useUiStore.getState().openTab("timeline"),
    },
    {
      id: "split",
      label: "Split selected clip at playhead",
      hint: "S",
      run: () => {
        const s = state();
        if (s.selectedClipId === null) return;
        const clip = s.timeline.clips[s.selectedClipId];
        if (clip === undefined) return;
        const at = s.playheadMs - clip.start;
        if (at > 0 && at < clip.duration) {
          s.dispatch({ type: "splitClip", clipId: clip.id, at });
        }
      },
      enabled: () => state().selectedClipId !== null,
    },
    {
      id: "delete",
      label: "Delete selected clip",
      hint: "Del",
      run: () => {
        const s = state();
        if (s.selectedClipId === null) return;
        s.dispatch({ type: "deleteClip", clipId: s.selectedClipId });
        s.selectClip(null);
      },
      enabled: () => state().selectedClipId !== null,
    },
    {
      id: "close-gaps",
      label: "Close gaps on all tracks",
      run: () => {
        const s = state();
        for (const op of closeGapsOps(s.timeline)) s.dispatch(op);
      },
    },
    {
      id: "undo",
      label: "Undo",
      hint: "Ctrl+Z",
      run: () => state().undo(),
    },
    {
      id: "redo",
      label: "Redo",
      hint: "Ctrl+Shift+Z",
      run: () => state().redo(),
    },
    {
      id: "zoom-in",
      label: "Zoom in",
      run: () => state().setZoom(state().pxPerSecond * 1.5),
    },
    {
      id: "zoom-out",
      label: "Zoom out",
      run: () => state().setZoom(state().pxPerSecond / 1.5),
    },
  ];
}
