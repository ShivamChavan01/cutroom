import { create } from "zustand";

/**
 * Shell UI state — which rail item is active, which editor tab is open,
 * which bottom-panel tab is showing. Separate from the editor store: this
 * is chrome, not timeline state, and it must never enter the op log.
 */

export type RailItem = "media" | "versions" | "issues";
export type EditorTab = "timeline" | "diff" | "merge";
export type BottomTab = "issues" | "activity";

interface UiStore {
  readonly rail: RailItem;
  readonly editorTab: EditorTab;
  readonly bottomTab: BottomTab;
  readonly setRail: (rail: RailItem) => void;
  readonly openTab: (tab: EditorTab) => void;
  readonly setBottomTab: (tab: BottomTab) => void;
}

export const useUiStore = create<UiStore>()((set) => ({
  rail: "media",
  editorTab: "timeline",
  bottomTab: "issues",
  setRail: (rail) => set({ rail }),
  openTab: (editorTab) => set({ editorTab }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
}));
