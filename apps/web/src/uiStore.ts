import { create } from "zustand";

/**
 * Shell UI state — which rail item is active, which editor tab is open,
 * which bottom-panel tab is showing. Separate from the editor store: this
 * is chrome, not timeline state, and it must never enter the op log.
 */

export type RailItem = "media" | "versions" | "issues" | "assistant" | "settings";
export type EditorTab = "timeline" | "diff" | "merge" | "verification";
export type BottomTab = "issues" | "activity";

interface UiStore {
  readonly rail: RailItem;
  readonly editorTab: EditorTab;
  readonly bottomTab: BottomTab;
  readonly reviewOpen: boolean;
  readonly inspectorTab: "clip" | "sequence" | "project";
  readonly setInspectorTab: (tab: "clip" | "sequence" | "project") => void;
  readonly hiddenTrackIds: readonly string[];
  readonly mutedTrackIds: readonly string[];
  readonly lockedTrackIds: readonly string[];
  readonly toggleTrackHidden: (id: string) => void;
  readonly toggleTrackMuted: (id: string) => void;
  readonly toggleTrackLocked: (id: string) => void;
  readonly setRail: (rail: RailItem) => void;
  readonly openTab: (tab: EditorTab) => void;
  readonly setBottomTab: (tab: BottomTab) => void;
  readonly setReviewOpen: (open: boolean) => void;
}

export const useUiStore = create<UiStore>()((set) => ({
  rail: "media",
  editorTab: "timeline",
  bottomTab: "issues",
  reviewOpen: false,
  inspectorTab: "clip",
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  hiddenTrackIds: [],
  mutedTrackIds: [],
  lockedTrackIds: [],
  toggleTrackHidden: (id) => set((state) => ({ hiddenTrackIds: toggleId(state.hiddenTrackIds, id) })),
  toggleTrackMuted: (id) => set((state) => ({ mutedTrackIds: toggleId(state.mutedTrackIds, id) })),
  toggleTrackLocked: (id) => set((state) => ({ lockedTrackIds: toggleId(state.lockedTrackIds, id) })),
  setRail: (rail) => set({ rail }),
  openTab: (editorTab) => set({ editorTab }),
  setBottomTab: (bottomTab) => set({ bottomTab, reviewOpen: true }),
  setReviewOpen: (reviewOpen) => set({ reviewOpen }),
}));

function toggleId(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}
