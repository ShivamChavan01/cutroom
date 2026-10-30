import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {useEffect} from "react";
import {conflictKey} from "@cutroom/engine";
import {installDemoProject} from "../demo/load";
import {useEditorStore} from "../../store";
import {useVcsStore} from "../../vcsStore";
import {usePersistenceStore} from "./persistenceStore";
import {deserializeProject} from "./project";
import {writeProject, type StorageResult} from "./storage";
import {useProjectPersistence} from "./usePersistence";

vi.mock("react", async original => ({...await original<typeof import("react")>(), useEffect: vi.fn()}));
vi.mock("./storage", async original => ({...await original<typeof import("./storage")>(), writeProject: vi.fn()}));
vi.mock("./persistenceStore", async original => {
  const actual = await original<typeof import("./persistenceStore")>();
  return {...actual, usePersistenceStore: Object.assign(
    <T,>(selector: (state: ReturnType<typeof actual.usePersistenceStore.getState>) => T) => selector(actual.usePersistenceStore.getState()),
    {getState: actual.usePersistenceStore.getState, setState: actual.usePersistenceStore.setState},
  )};
});

const writes: {raw: string; resolve: (value: StorageResult<boolean>) => void; reject: (error: Error) => void}[] = [];
const ok: StorageResult<boolean> = {ok: true, value: true, status: "ok"};
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("window", globalThis); vi.clearAllMocks(); writes.length = 0;
  installDemoProject();
  usePersistenceStore.setState({hydrated: true, loadFailure: null, status: "saved", message: null});
  vi.mocked(writeProject).mockImplementation(raw => new Promise((resolve, reject) => {writes.push({raw, resolve, reject});}));
  // Execute only the real autosave effect; hydration has already completed.
  useProjectPersistence();
  const effect = vi.mocked(useEffect).mock.calls.at(-1)?.[0];
  if (effect === undefined) throw new Error("Expected autosave effect");
  const cleanup = effect();
  if (typeof cleanup === "function") stop = cleanup;
});
afterEach(() => {stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals();});
function edit(name: string) {
  useEditorStore.getState().dispatch({type: "renameProject", name});
  useVcsStore.getState().commitCurrent(name);
}
it("an older write cannot acknowledge a newer visible commit as saved", async () => {
  edit("First snapshot"); await vi.advanceTimersByTimeAsync(700);
  expect(writes).toHaveLength(1);
  expect(usePersistenceStore.getState().status).toBe("saving");
  edit("Second snapshot"); writes[0]!.resolve(ok); await vi.advanceTimersByTimeAsync(0);
  expect(usePersistenceStore.getState().status).toBe("unsaved");
  await vi.advanceTimersByTimeAsync(700); expect(writes).toHaveLength(2);
  const restored = deserializeProject(writes[1]!.raw);
  expect(restored.repo.commits[restored.repo.branches.main!]!.message).toBe("Second snapshot");
  writes[1]!.resolve(ok); await vi.advanceTimersByTimeAsync(0);
  expect(usePersistenceStore.getState().status).toBe("saved");
});
it.each(["success", "failure"])("stale %s completion cannot overwrite a newer saved state", async outcome => {
  edit("First"); await vi.advanceTimersByTimeAsync(700);
  edit("Second"); await vi.advanceTimersByTimeAsync(700);
  writes[1]!.resolve(ok); await vi.advanceTimersByTimeAsync(0);
  writes[0]!.resolve(outcome === "success" ? ok : {ok: false, status: "error", error: "older failure"});
  await vi.advanceTimersByTimeAsync(0);
  expect(usePersistenceStore.getState()).toMatchObject({status: "saved", message: null});
});
it("a pending resolution journal change invalidates an in-flight acknowledgement", async () => {
  const vcs = useVcsStore.getState(); vcs.beginMerge("alternate"); await vi.advanceTimersByTimeAsync(0);
  const conflict = useVcsStore.getState().pending?.result.conflicts[0];
  if (conflict === undefined) throw new Error("Expected overlap");
  vcs.resolveConflict(conflictKey(conflict), "a"); writes[0]!.resolve(ok);
  await vi.advanceTimersByTimeAsync(0);
  expect(usePersistenceStore.getState().status).not.toBe("saved");
  expect(writes).toHaveLength(2); expect(deserializeProject(writes[1]!.raw).pending?.resolutions).toHaveLength(1);
  writes[1]!.resolve(ok); await vi.advanceTimersByTimeAsync(0);
  expect(usePersistenceStore.getState().status).toBe("saved");
});
it.each(["success", "failure"])("ignores in-flight %s completion after effect disposal", async outcome => {
  edit("First"); await vi.advanceTimersByTimeAsync(700); stop?.(); stop = undefined;
  usePersistenceStore.getState().setStatus("idle");
  writes[0]!.resolve(outcome === "success" ? ok : {ok: false, status: "error", error: "disposed failure"});
  await vi.advanceTimersByTimeAsync(1000); expect(usePersistenceStore.getState().status).toBe("idle");
});
it("reports current storage failure and unexpected rejection without saying saved", async () => {
  edit("First"); await vi.advanceTimersByTimeAsync(700);
  writes[0]!.resolve({ok: false, status: "unavailable", error: "storage denied"}); await vi.advanceTimersByTimeAsync(0);
  expect(usePersistenceStore.getState()).toMatchObject({status: "unavailable", message: "storage denied"});
  edit("Second"); await vi.advanceTimersByTimeAsync(700); writes[1]!.reject(new Error("unexpected write failure")); await vi.advanceTimersByTimeAsync(0);
  expect(usePersistenceStore.getState()).toMatchObject({status: "error", message: "unexpected write failure"});
});
