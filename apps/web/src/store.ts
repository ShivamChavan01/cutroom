import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import {
  type Clip,
  type History,
  type Op,
  type Timeline,
  canRedo,
  canUndo,
  clipsOnTrack,
  createHistory,
  current,
  emptyTimeline,
  record,
  redo as historyRedo,
  undo as historyUndo,
} from "@cutroom/engine";

/**
 * Local author identity. No auth in this prototype: a stable name in
 * localStorage, created once. The color is derived from the name downstream
 * (presence, blame) so identity and color can never disagree.
 */
function getOrCreateAuthorId(): string {
  const KEY = "cutroom.authorId";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing !== null && existing.length > 0) return existing;
    const fresh = `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Non-browser environment (tests): ephemeral identity, never persisted.
    return `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
  }
}

export interface EditorStore {
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
  readonly undo: () => void;
  readonly redo: () => void;
  readonly selectClip: (id: string | null) => void;
  readonly setPlayhead: (ms: number) => void;
  readonly play: () => void;
  readonly pause: () => void;
  readonly setZoom: (pxPerSecond: number) => void;
  /** Replace the whole editing session (tests, branch checkout later). */
  readonly loadTimeline: (timeline: Timeline) => void;
}

function derive(history: History): Pick<EditorStore, "history" | "timeline"> {
  return { history, timeline: current(history) };
}

export const useEditorStore = create<EditorStore>()((set) => ({
  ...derive(createHistory(emptyTimeline("untitled"))),
  selectedClipId: null,
  playheadMs: 0,
  isPlaying: false,
  pxPerSecond: 50,
  authorId: getOrCreateAuthorId(),

  dispatch: (op) =>
    set((state) => ({
      ...derive(record(state.history, op, state.authorId)),
    })),

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
      ...derive(createHistory(timeline)),
      selectedClipId: null,
      playheadMs: 0,
      isPlaying: false,
      authorId: state.authorId,
    })),
}));

// ---------------------------------------------------------------------------
// Narrow selectors. A clip component subscribing to useClip(id) re-renders
// only when that clip object changes identity — not on playhead ticks,
// not when other clips change. This is the actual perf lever: derive()
// replaces the whole clips map on every op, but object identity for
// untouched clips is preserved by the engine's structural sharing, so
// reference equality here is meaningful.
// ---------------------------------------------------------------------------

export function useClip(id: string): Clip | undefined {
  return useEditorStore((state) => state.timeline.clips[id]);
}

export function useClipsOnTrack(trackId: string): readonly Clip[] {
  return useEditorStore(
    useShallow((state) => clipsOnTrack(state.timeline, trackId)),
  );
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
