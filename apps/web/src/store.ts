import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import {
  type Asset,
  type Clip,
  type History,
  type Op,
  type Timeline,
  applyOp,
  canRedo,
  canUndo,
  createHistory,
  current,
  emptyTimeline,
  putAsset,
  record,
  redo as historyRedo,
  undo as historyUndo,
} from "@cutroom/engine";
import { getOrCreateAuthorId } from "./lib/identity";
import { useUiStore } from "./uiStore";
import { indexedClipsOnTrack } from "./lib/clipIndex";
import { previewPlan } from "./lib/assistant/proposal";

export interface EditorStore {
  /** Runtime ownership token for async imports; changes on session replacement, not edits. */
  readonly sessionId: number;
  readonly history: History;
  /** Derived from history on every mutation. Never written directly. */
  readonly timeline: Timeline;
  readonly selectedClipId: string | null;
  readonly playheadMs: number;
  readonly isPlaying: boolean;
  /** Zoom level. §2 timeScale reads this; one value drives all rendering. */
  readonly pxPerSecond: number;
  readonly authorId: string;

  /** Local edit — the store is the "local edits" call site for applyOp. */
  readonly dispatch: (op: Op) => void;
  readonly applyProposal: (before: Timeline, ops: readonly Op[]) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly selectClip: (id: string | null) => void;
  readonly setPlayhead: (ms: number) => void;
  readonly play: () => void;
  readonly pause: () => void;
  readonly setZoom: (pxPerSecond: number) => void;
  /** Replace the whole editing session (tests, branch checkout later). */
  readonly loadTimeline: (timeline: Timeline) => void;
  /**
   * Restore a persisted history (op log + cursor) and the timeline it
   * implies. Used by persistence on start; the op log is validated before
   * it gets here.
   */
  readonly restoreHistory: (history: History) => void;
  /**
   * Register an asset without touching the op log. Assets ride in the
   * history base, so undo/redo replay keeps working — the log only holds
   * clip ops, and the base carries everything the log needs to interpret.
   */
  readonly addAsset: (asset: Asset) => void;
}

function derive(history: History): Pick<EditorStore, "history" | "timeline"> {
  return { history, timeline: current(history) };
}

export const useEditorStore = create<EditorStore>()((set) => ({
  sessionId: 0,
  ...derive(createHistory(emptyTimeline("untitled"))),
  selectedClipId: null,
  playheadMs: 0,
  isPlaying: false,
  pxPerSecond: 50,
  authorId: getOrCreateAuthorId(),

  dispatch: (op) =>
    set((state) => {
      const id = "clipId" in op ? op.clipId : op.type === "addClip" ? op.clip.id : undefined;
      const sourceTrack = id === undefined ? undefined : state.timeline.clips[id]?.trackId;
      const destinationTrack = op.type === "addClip" ? op.clip.trackId : (op.type === "moveClip" || op.type === "detachAudio") ? op.trackId : undefined;
      const locked = useUiStore.getState().lockedTrackIds;
      if ((sourceTrack !== undefined && locked.includes(sourceTrack)) || (destinationTrack !== undefined && locked.includes(destinationTrack))) {
        throw new Error("This track is locked. Unlock it before editing.");
      }
      const timeline = applyOp(state.timeline, op);
      if (timeline === state.timeline) return state;
      const history = record(state.history, op, state.authorId);
      return { history, timeline };
    }),

  applyProposal: (before, ops) =>
    set((state) => {
      if (state.timeline !== before) throw new Error("The timeline changed. Generate a new proposal before applying.");
      const proposal = previewPlan(before, { summary: "Apply proposal", ops: [...ops] }, useUiStore.getState().lockedTrackIds);
      let history = state.history;
      for (const op of ops) history = record(history, op, state.authorId);
      return { history, timeline: proposal.after };
    }),

  undo: () =>
    set((state) =>
      canUndo(state.history)
        ? { ...derive(historyUndo(state.history)) }
        : state,
    ),

  redo: () =>
    set((state) =>
      canRedo(state.history)
        ? { ...derive(historyRedo(state.history)) }
        : state,
    ),

  selectClip: (id) => set({ selectedClipId: id }),
  setPlayhead: (ms) => set({ playheadMs: Math.max(0, ms) }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  setZoom: (pxPerSecond) =>
    set({ pxPerSecond: Math.min(400, Math.max(5, pxPerSecond)) }),

  loadTimeline: (timeline) =>
    set((state) => ({
      sessionId: state.sessionId + 1,
      ...derive(createHistory(timeline)),
      selectedClipId: null,
      playheadMs: 0,
      isPlaying: false,
      authorId: state.authorId,
    })),

  // Source registration is durable across clip undo; metadata edits use Ops.
  addAsset: (asset) =>
    set((state) => {
      if (state.timeline.assets[asset.id] !== undefined) throw new Error("This source is already registered. Change its metadata through an edit operation.");
      return derive({...state.history, base: putAsset(state.history.base, asset)});
    }),

  restoreHistory: (history) =>
    set((state) => ({
      sessionId: state.sessionId + 1,
      ...derive(history),
      selectedClipId: null,
      playheadMs: 0,
      isPlaying: false,
      authorId: state.authorId,
    })),
}));

// ---------------------------------------------------------------------------
// Narrow selectors. A clip component subscribing to useClip(id) re-renders
// only when that clip object changes identity — not on playhead ticks,
// not when other clips change. Dispatch applies only the new operation,
// preserving untouched clip references even when prior edits changed them.
// ---------------------------------------------------------------------------

export function useClip(id: string): Clip | undefined {
  return useEditorStore((state) => state.timeline.clips[id]);
}

export function useClipsOnTrack(trackId: string): readonly Clip[] {
  return useEditorStore((state) => indexedClipsOnTrack(state.timeline, trackId));
}

export function useTrackIds(): readonly string[] {
  return useEditorStore(
    useShallow((state) => state.timeline.tracks.map((track) => track.id)),
  );
}

export function usePlayhead(): number {
  return useEditorStore((state) => state.playheadMs);
}

export function useSelection(): string | null {
  return useEditorStore((state) => state.selectedClipId);
}
