import { create } from "zustand";

/**
 * Shell UI state — which rail item is active, which editor tab is open,
 * which bottom-panel tab is showing. Separate from the editor store: this
 * is chrome, not timeline state, and it must never enter the op log.
 */

export type RailItem = "media" | "versions" | "issues" | "settings";
export type EditorTab = "timeline" | "diff" | "merge";
export type PropertiesTab = "inspector" | "assistant";

interface UiStore {
  readonly scrubbing: boolean;
  readonly setScrubbing: (scrubbing: boolean) => void;
  readonly propertiesTab: PropertiesTab | null;
  readonly setPropertiesTab: (tab: PropertiesTab | null) => void;
  readonly rail: RailItem | null;
  readonly editorTab: EditorTab;
  readonly reviewOpen: boolean;
  readonly inspectorTab: "clip" | "sequence" | "project";
  readonly setInspectorTab: (tab: "clip" | "sequence" | "project") => void;
  readonly hiddenTrackIds: readonly string[];
  readonly mutedTrackIds: readonly string[];
  readonly lockedTrackIds: readonly string[];
  readonly toggleTrackHidden: (id: string) => void;
  readonly toggleTrackMuted: (id: string) => void;
  readonly toggleTrackLocked: (id: string) => void;
  readonly setRail: (rail: RailItem | null) => void;
  readonly openTab: (tab: EditorTab) => void;
  readonly setReviewOpen: (open: boolean) => void;
}

export const useUiStore = create<UiStore>()((set) => ({
  scrubbing: false,
  setScrubbing: (scrubbing) => set({ scrubbing }),
  propertiesTab: null,
  setPropertiesTab: (propertiesTab) => set({ propertiesTab, rail: null }),
  rail: null,
  editorTab: "timeline",
  reviewOpen: false,
  inspectorTab: "clip",
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  hiddenTrackIds: [],
  mutedTrackIds: [],
  lockedTrackIds: [],
  toggleTrackHidden: (id) => set((state) => ({ hiddenTrackIds: toggleId(state.hiddenTrackIds, id) })),
  toggleTrackMuted: (id) => set((state) => ({ mutedTrackIds: toggleId(state.mutedTrackIds, id) })),
  toggleTrackLocked: (id) => set((state) => ({ lockedTrackIds: toggleId(state.lockedTrackIds, id) })),
  setRail: (rail) => set(rail === "issues" ? { rail, propertiesTab: null, editorTab: "timeline" } : { rail, propertiesTab: null }),
  openTab: (editorTab) => set({ editorTab }),
  setReviewOpen: (reviewOpen) => set({ reviewOpen }),
}));

function toggleId(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}
