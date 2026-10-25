import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./uiStore";

describe("workspace navigation", () => {
  beforeEach(() => useUiStore.setState({ rail: "media", editorTab: "timeline", bottomTab: "issues", reviewOpen: false }));

  it("switches library views independently from the editor", () => {
    useUiStore.getState().setRail("versions");
    expect(useUiStore.getState().rail).toBe("versions");
    expect(useUiStore.getState().editorTab).toBe("timeline");
  });

  it("opens editor views without changing the library", () => {
    useUiStore.getState().openTab("merge");
    expect(useUiStore.getState().editorTab).toBe("merge");
    expect(useUiStore.getState().rail).toBe("media");
  });

  it.each(["issues", "activity"] as const)("reveals the review drawer when opening %s", (tab) => {
    useUiStore.getState().setBottomTab(tab);
    expect(useUiStore.getState().bottomTab).toBe(tab);
    expect(useUiStore.getState().reviewOpen).toBe(true);
  });

  it("collapses and reopens the drawer without losing its selected view", () => {
    useUiStore.getState().setBottomTab("activity");
    useUiStore.getState().setReviewOpen(false);
    expect(useUiStore.getState().reviewOpen).toBe(false);
    useUiStore.getState().setReviewOpen(true);
    expect(useUiStore.getState().bottomTab).toBe("activity");
  });

  it.each([
    ["toggleTrackHidden", "hiddenTrackIds"],
    ["toggleTrackMuted", "mutedTrackIds"],
    ["toggleTrackLocked", "lockedTrackIds"],
  ] as const)("toggles track preference %s independently", (action, field) => {
    useUiStore.setState({ hiddenTrackIds: [], mutedTrackIds: [], lockedTrackIds: [] });
    useUiStore.getState()[action]("v1");
    useUiStore.getState()[action]("v2");
    expect(useUiStore.getState()[field]).toEqual(["v1", "v2"]);
    useUiStore.getState()[action]("v1");
    expect(useUiStore.getState()[field]).toEqual(["v2"]);
  });
});
