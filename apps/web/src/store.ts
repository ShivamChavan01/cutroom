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
import { useProductionStore } from "./productionStore";
import { assertUnlocked, previewPlan } from "./lib/assistant/proposal";
import { audioClip, createGainSuggestions, gainFeedback, gainOffer, suppressGainOffer, type GainSuggestions } from "./lib/gainSuggestions";

export interface GainPreview {
  readonly proposal: ReturnType<typeof previewPlan>;
  readonly history: History;
  readonly epoch: number;
  readonly offerKey: string;
  readonly lockedTracks: readonly string[];
}

export interface EditorStore {
  /** Runtime ownership token for async imports; changes on session replacement, not edits. */
  readonly sessionId: number;
  readonly history: History;
  /** Derived from history on every mutation. Never written directly. */
  readonly timeline: Timeline;
  readonly selectedClipId: string | null;
  readonly selectionRevision: number;
  readonly playheadMs: number;
  readonly isPlaying: boolean;
  /** Zoom level. §2 timeScale reads this; one value drives all rendering. */
  readonly pxPerSecond: number;
  readonly authorId: string;
  readonly gainSuggestions: GainSuggestions;
  readonly beginGainGesture: (clipId: string) => void;
  readonly changeGain: (clipId: string, volume: number) => void;
  readonly finishGainGesture: (clipId: string) => void;
  readonly cancelGainGesture: (clipId: string) => void;
  readonly previewGainSuggestion: (key: string) => GainPreview;
  readonly applyGainSuggestion: (preview: GainPreview) => void;
  readonly dismissGainSuggestion: (key: string) => void;
  readonly noteGainSuggestion: (key: string) => void;
  readonly setGainSuggestionsEnabled: (enabled: boolean) => void;
  readonly invalidateGainContext: (scope: { replace: boolean; blocked: boolean }) => void;

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

function applyProposalEdits(state: EditorStore, before: Timeline, ops: readonly Op[]) {
  if (state.timeline !== before) throw new Error("The timeline changed. Generate a new proposal before applying.");
  const proposal = previewPlan(before, { summary: "Apply proposal", ops: [...ops] }, useUiStore.getState().lockedTrackIds, useProductionStore.getState().document);
  if (proposal.production?.regression != null) throw new Error(proposal.production.regression);
  let history = state.history;
  for (const op of ops) history = record(history, op, state.authorId);
  return { history, timeline: proposal.after };
}

function replacedGainContext(session: GainSuggestions): GainSuggestions {
  return { ...createGainSuggestions(), enabled: session.enabled, blocked: session.blocked, epoch: session.epoch + 1 };
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
  sessionId: 0,
  ...derive(createHistory(emptyTimeline("untitled"))),
  selectedClipId: null,
  selectionRevision: 0,
  playheadMs: 0,
  isPlaying: false,
  pxPerSecond: 50,
  authorId: getOrCreateAuthorId(),
  gainSuggestions: createGainSuggestions(),

  beginGainGesture: (clipId) => set(state => {
    const session = state.gainSuggestions;
    if (session.gesture?.clip.id === clipId) return state;
    const clip = audioClip(state.timeline, clipId);
    if (!session.enabled || session.blocked || state.isPlaying || clip === undefined || state.selectedClipId !== clipId
      || useUiStore.getState().lockedTrackIds.includes(clip.trackId)) return state;
    return { gainSuggestions: { ...session, epoch: session.epoch + 1, gesture: { clip, envelope: null, lockedTracks: useUiStore.getState().lockedTrackIds } } };
  }),

  changeGain: (clipId, volume) => {
    try {
      set(state => {
        if (state.selectedClipId !== clipId) throw new Error("Select this clip before changing its gain.");
        const op: Op = { type: "setVolume", clipId, volume };
        assertUnlocked(state.timeline, op, useUiStore.getState().lockedTrackIds);
        const timeline = applyOp(state.timeline, op);
        if (state.timeline.clips[clipId]?.volume === volume) return state;
        const history = record(state.history, op, state.authorId);
        const envelope = history.log.at(-1);
        const session = state.gainSuggestions;
        const gesture = session.gesture;
        return { timeline, history, gainSuggestions: { ...session,
          gesture: gesture !== null && gesture.clip.id === clipId && envelope !== undefined ? { ...gesture, envelope } : null } };
      });
    } catch (error) {
      get().cancelGainGesture(clipId);
      throw error;
    }
  },

  finishGainGesture: (clipId) => set(state => {
    const session = state.gainSuggestions, gesture = session.gesture;
    if (gesture === null || gesture.clip.id !== clipId) return state;
    const clip = audioClip(state.timeline, clipId);
    const valid = gesture.envelope !== null && state.history.log[state.history.cursor - 1] === gesture.envelope
      && clip !== undefined && clip.volume !== gesture.clip.volume && clip.assetId === gesture.clip.assetId
      && clip.trackId === gesture.clip.trackId && state.selectedClipId === clipId && !state.isPlaying && !session.blocked
      && gesture.lockedTracks === useUiStore.getState().lockedTrackIds
      && !useUiStore.getState().lockedTrackIds.includes(clip.trackId);
    if (!valid || clip === undefined || gesture.envelope === null) return { gainSuggestions: { ...session, gesture: null } };
    const id = session.nextDecision + 1;
    return { gainSuggestions: { ...session, gesture: null, nextDecision: id,
      decisions: [...session.decisions, { id, clip, envelope: gesture.envelope }].slice(-32) } };
  }),

  cancelGainGesture: (clipId) => set(state => state.gainSuggestions.gesture?.clip.id !== clipId ? state
    : { gainSuggestions: { ...state.gainSuggestions, epoch: state.gainSuggestions.epoch + 1, gesture: null } }),

  previewGainSuggestion: (key) => {
    const state = get(), offer = gainOffer(state, useUiStore.getState().lockedTrackIds);
    if (offer === null || offer.key !== key) throw new Error("This suggestion is no longer current.");
    const proposal = previewPlan(state.timeline, { summary: "Match recent gain", ops: [{ type: "setVolume", clipId: offer.clipId, volume: offer.volume }] }, useUiStore.getState().lockedTrackIds);
    set({ gainSuggestions: gainFeedback(state.gainSuggestions, "previewed", offer) });
    return { proposal, history: state.history, epoch: state.gainSuggestions.epoch, offerKey: key, lockedTracks: useUiStore.getState().lockedTrackIds };
  },

  applyGainSuggestion: (preview) => set(state => {
    const offer = gainOffer(state, useUiStore.getState().lockedTrackIds);
    if (offer === null || offer.key !== preview.offerKey || state.gainSuggestions.epoch !== preview.epoch
      || state.timeline !== preview.proposal.before || state.history !== preview.history || preview.lockedTracks !== useUiStore.getState().lockedTrackIds) {
      throw new Error("This suggestion changed. Preview it again before applying.");
    }
    // Rebuild the single supported operation from current evidence, never from the review payload.
    const edits = applyProposalEdits(state, preview.proposal.before, [{ type: "setVolume", clipId: offer.clipId, volume: offer.volume }]);
    const envelope = edits.history.log.at(-1);
    if (envelope === undefined) throw new Error("Could not record the gain suggestion.");
    const session = gainFeedback(suppressGainOffer(state.gainSuggestions, offer), "applied", offer);
    return { ...edits, gainSuggestions: { ...session, application: { offer, envelope } } };
  }),

  dismissGainSuggestion: (key) => set(state => {
    const offer = gainOffer(state, useUiStore.getState().lockedTrackIds);
    return offer === null || offer.key !== key ? state
      : { gainSuggestions: gainFeedback(suppressGainOffer(state.gainSuggestions, offer), "dismissed", offer) };
  }),

  noteGainSuggestion: (key) => set(state => {
    const offer = gainOffer(state, useUiStore.getState().lockedTrackIds);
    return offer === null || offer.key !== key ? state : { gainSuggestions: gainFeedback(state.gainSuggestions, "shown", offer) };
  }),

  setGainSuggestionsEnabled: (enabled) => set(state => ({ gainSuggestions: { ...replacedGainContext(state.gainSuggestions), enabled } })),

  invalidateGainContext: ({ replace, blocked }) => set(state => ({ gainSuggestions: {
    ...(replace ? replacedGainContext(state.gainSuggestions) : { ...state.gainSuggestions, epoch: state.gainSuggestions.epoch + 1, gesture: null }), blocked,
  } })),

  dispatch: (op) =>
    set((state) => {
      assertUnlocked(state.timeline, op, useUiStore.getState().lockedTrackIds);
      const timeline = applyOp(state.timeline, op);
      if (timeline === state.timeline) return state;
      const history = record(state.history, op, state.authorId);
      return { history, timeline, gainSuggestions: { ...state.gainSuggestions, gesture: null } };
    }),

  applyProposal: (before, ops) =>
    set((state) => {
      return { ...applyProposalEdits(state, before, ops), gainSuggestions: { ...state.gainSuggestions, gesture: null } };
    }),

  undo: () =>
    set((state) => {
      if (!canUndo(state.history)) return state;
      const session = state.gainSuggestions, application = session.application;
      const gainSuggestions = application !== null && state.history.log[state.history.cursor - 1] === application.envelope
        ? gainFeedback(session, "undone", application.offer) : session;
      return { ...derive(historyUndo(state.history)), gainSuggestions: { ...gainSuggestions, gesture: null } };
    }),

  redo: () =>
    set((state) =>
      canRedo(state.history)
        ? { ...derive(historyRedo(state.history)), gainSuggestions: { ...state.gainSuggestions, gesture: null } }
        : state,
    ),

  selectClip: (id) => set(state => state.selectedClipId === id ? state : { selectedClipId: id, selectionRevision: state.selectionRevision + 1,
    gainSuggestions: { ...state.gainSuggestions, epoch: state.gainSuggestions.epoch + 1, gesture: null } }),
  setPlayhead: (ms) => set({ playheadMs: Math.max(0, ms) }),
  play: () => set(state => ({ isPlaying: true, gainSuggestions: { ...state.gainSuggestions, epoch: state.gainSuggestions.epoch + 1, gesture: null } })),
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
      gainSuggestions: replacedGainContext(state.gainSuggestions),
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
      gainSuggestions: replacedGainContext(state.gainSuggestions),
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
