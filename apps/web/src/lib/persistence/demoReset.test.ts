import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { resetProject } from "./usePersistence";
import { readProject, writeProject, clearProject } from "./storage";
import { useEditorStore } from "../../store";
import { useVcsStore } from "../../vcsStore";
import { usePersistenceStore } from "./persistenceStore";
import { installDemoProject } from "../demo/load";

afterEach(async () => {vi.unstubAllGlobals(); await clearProject("current"); await clearProject("current.demo-v1");});

it("resets only demo state, leaving the persisted personal project byte-for-byte intact", async () => {
  await writeProject("personal data", "current");
  await writeProject("sample edits", "current.demo-v1");
  vi.stubGlobal("location", {search: "?demo=1"});
  installDemoProject();
  useVcsStore.getState().beginMerge("alternate");
  useEditorStore.getState().dispatch({type: "deleteClip", clipId: "opening"});
  expect(await resetProject()).toBe(true);
  expect((await readProject("current")).value).toBe("personal data");
  expect((await readProject("current.demo-v1")).value).toBeUndefined();
  expect(useEditorStore.getState().timeline.clips.opening).toBeDefined();
  expect(useVcsStore.getState().pending).toBeNull();
});

it("does not discard working edits when storage reset is unavailable", async () => {
  installDemoProject();
  useEditorStore.getState().dispatch({type: "deleteClip", clipId: "opening"});
  const before = useEditorStore.getState().timeline;
  vi.stubGlobal("indexedDB", undefined);
  expect(await resetProject()).toBe(false);
  expect(useEditorStore.getState().timeline).toBe(before);
  expect(usePersistenceStore.getState().status).toBe("unavailable");
});

it("retains the existing personal reset behavior in the default workspace", async () => {
  installDemoProject();
  expect(await resetProject()).toBe(true);
  expect(useEditorStore.getState().timeline.id).toBe("untitled");
  expect(Object.keys(useEditorStore.getState().timeline.clips)).toEqual([]);
  expect(Object.keys(useVcsStore.getState().repo!.commits)).toEqual(["c0"]);
});
