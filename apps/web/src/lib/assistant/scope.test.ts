import { beforeEach, expect, it } from "vitest";
import { emptyTimeline } from "@cutroom/engine";
import { captureAssistantScope, assistantScopeIsCurrent } from "./scope";
import { useEditorStore } from "../../store";
import { useVcsStore } from "../../vcsStore";
import { useUiStore } from "../../uiStore";
import { useProductionStore } from "../../productionStore";

beforeEach(() => {
  useEditorStore.getState().loadTimeline(emptyTimeline());
  useVcsStore.setState({ repo: null, pending: null });
  useUiStore.setState({ lockedTrackIds: [] });
  useProductionStore.getState().clear();
});
it("accepts the captured live scope and invalidates selection away and back", () => {
  const scope = captureAssistantScope(); expect(assistantScopeIsCurrent(scope)).toBe(true);
  useEditorStore.getState().selectClip("other"); useEditorStore.getState().selectClip(null);
  expect(assistantScopeIsCurrent(scope)).toBe(false);
});
it("keeps a proposal current while the editor seeks, plays and pauses", () => {
  const scope = captureAssistantScope();
  useEditorStore.getState().setPlayhead(1000);
  useEditorStore.getState().play();
  expect(assistantScopeIsCurrent(scope)).toBe(true);
  useEditorStore.getState().pause();
  expect(assistantScopeIsCurrent(scope)).toBe(true);
});
it.each(["brief", "locks", "session", "version", "timeline"])("invalidates %s changes before Apply", change => {
  const scope = captureAssistantScope();
  if (change === "brief") useProductionStore.getState().install({ version: 1, brief: "A revised brief", styleReferences: [], requirements: [], evidence: [] });
  if (change === "locks") { useUiStore.getState().toggleTrackLocked("v1"); useUiStore.getState().toggleTrackLocked("v1"); }
  if (change === "session") useEditorStore.getState().loadTimeline(scope.timeline);
  if (change === "version") useVcsStore.getState().ensureRepo();
  if (change === "timeline") useEditorStore.getState().dispatch({ type: "renameProject", name: "Changed cut" });
  expect(assistantScopeIsCurrent(scope)).toBe(false);
});
