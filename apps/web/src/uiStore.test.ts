import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./uiStore";

describe("workspace navigation", () => {
  beforeEach(() => useUiStore.setState({ propertiesTab: null, rail: null, editorTab: "timeline", reviewOpen: false }));

  it("opens only the chosen sidebar while keeping the timeline available", () => {
    const store = useUiStore.getState();
    store.setRail("versions");
    store.setPropertiesTab("assistant");
    expect(useUiStore.getState()).toMatchObject({ propertiesTab: "assistant", rail: null, editorTab: "timeline" });
    store.setRail("issues");
    expect(useUiStore.getState().propertiesTab).toBeNull();
    store.setPropertiesTab("inspector");
    expect(useUiStore.getState()).toMatchObject({ propertiesTab: "inspector", rail: null });
  });

  it("switches library views independently from the editor", () => {
    useUiStore.getState().setRail("versions");
    expect(useUiStore.getState().rail).toBe("versions");
    expect(useUiStore.getState().editorTab).toBe("timeline");
  });

  it("opens editor views without changing the library", () => {
    useUiStore.getState().openTab("merge");
    expect(useUiStore.getState().editorTab).toBe("merge");
    expect(useUiStore.getState().rail).toBeNull();
  });

  it("closes either sidebar without changing the current editing view", () => {
    const store = useUiStore.getState();
    store.openTab("diff");
    store.setPropertiesTab("assistant");
    store.setPropertiesTab(null);
    expect(useUiStore.getState()).toMatchObject({ propertiesTab: null, editorTab: "diff" });
  });

  it("opens Issues beside the timeline, independently from activity", () => {
    const store = useUiStore.getState();
    store.openTab("diff");
    store.setRail("issues");
    expect(useUiStore.getState()).toMatchObject({ rail: "issues", editorTab: "timeline", reviewOpen: false });
    store.setReviewOpen(true);
    expect(useUiStore.getState().reviewOpen).toBe(true);
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
