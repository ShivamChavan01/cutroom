import { beforeEach, expect, it, vi } from "vitest";
import { emptyTimeline } from "@cutroom/engine";
import { useEditorStore } from "../../store";
import { useVcsStore } from "../../vcsStore";
import { usePersistenceStore } from "./persistenceStore";
import { clearProject } from "./storage";
import { resetProject } from "./usePersistence";
import { useProductionStore } from "../../productionStore";
import { useUiStore } from "../../uiStore";
vi.mock("./storage", async original => ({ ...await original<typeof import("./storage")>(), clearProject: vi.fn() }));
beforeEach(() => {
  useEditorStore.getState().loadTimeline(emptyTimeline("Keep my work"));
  useVcsStore.setState({ repo: null, pending: null, diffOverlay: null });
  useVcsStore.getState().ensureRepo();
  useProductionStore.getState().install({ version: 1, brief: "Keep this production brief", styleReferences: [], requirements: [], evidence: [] });
});
it("keeps the current project and reports a failed reset", async () => {
  vi.mocked(clearProject).mockResolvedValue({ ok: false, status: "error", error: "storage denied" });
  const editor = useEditorStore.getState(), repo = useVcsStore.getState().repo;
  await resetProject();
  expect(useEditorStore.getState()).toBe(editor);
  expect(useVcsStore.getState().repo).toBe(repo);
  expect(useProductionStore.getState().document?.brief).toBe("Keep this production brief");
  expect(usePersistenceStore.getState()).toMatchObject({ status: "error", message: "storage denied" });
});
it("resets only after successful storage deletion", async () => {
  useUiStore.getState().setPropertiesTab("assistant");
  vi.mocked(clearProject).mockResolvedValue({ ok: true, status: "ok", value: true });
  await resetProject();
  expect(useEditorStore.getState().timeline.id).toBe("untitled");
  expect(useVcsStore.getState().repo?.commits.c0?.timeline).toEqual(useEditorStore.getState().timeline);
  expect(useProductionStore.getState().document).toBeNull();
  expect(useUiStore.getState()).toMatchObject({ propertiesTab: null, rail: null });
  expect(usePersistenceStore.getState().status).toBe("idle");
});
