import {conflictKey} from "@cutroom/engine";
import {deserializeProject, toHistory, toRepo} from "./project";
import {beforeEach, expect, it} from "vitest";
import {installDemoProject} from "../demo/load";
import {useEditorStore} from "../../store";
import {useVcsStore} from "../../vcsStore";
import {serializeProject} from "./project";

beforeEach(() => installDemoProject());
it("includes a real pending merge in the project save", () => {
  useVcsStore.getState().beginMerge("alternate");
  const {history} = useEditorStore.getState();
  const {repo, pending} = useVcsStore.getState();
  if (repo === null || pending === null) throw new Error("Expected sample merge");
  const input = {history, repo, pending};
  const raw = serializeProject(input);
  expect(JSON.parse(raw).pending).toBeDefined();
});


function save() {
  const {history} = useEditorStore.getState();
  const {repo, pending} = useVcsStore.getState();
  if (repo === null) throw new Error("Expected repository");
  return serializeProject({history, repo, pending});
}
function restore(raw: string) {
  const project = deserializeProject(raw);
  useEditorStore.getState().restoreHistory(toHistory(project.history));
  useVcsStore.getState().restoreRepo(toRepo(project.repo), project.pending);
  return project;
}
function resolveFirst(choice: "ours" | "a") {
  const conflict = useVcsStore.getState().pending?.result.conflicts[0];
  if (conflict === undefined) throw new Error("Expected conflict");
  useVcsStore.getState().resolveConflict(conflictKey(conflict), choice);
}

it("reconstructs actual unresolved conflicts and never persists a trusted clean result", () => {
  useVcsStore.getState().beginMerge("alternate");
  const before = useVcsStore.getState().pending;
  const raw = save();
  expect(JSON.parse(raw).pending.result).toBeUndefined();
  expect(restore(raw).pending).toEqual(before);
  expect(() => useVcsStore.getState().commitMerge("unfinished")).toThrow(/conflicts/);
});
it("preserves a partial resolution, then commits both parents after a second restore", () => {
  const vcs = useVcsStore.getState();
  useEditorStore.getState().dispatch({type: "renameProject", name: "Our title"});
  vcs.commitCurrent("Our title");
  vcs.checkoutBranch("alternate");
  useEditorStore.getState().dispatch({type: "renameProject", name: "Their title"});
  vcs.commitCurrent("Their title");
  vcs.checkoutBranch("main");
  vcs.beginMerge("alternate");
  const projectConflict = useVcsStore.getState().pending!.result.conflicts.find(item => item.kind === "project");
  if (projectConflict === undefined) throw new Error("Expected conflicting titles");
  vcs.resolveConflict(conflictKey(projectConflict), "ours");
  const partlyResolved = useVcsStore.getState().pending;
  expect(restore(save()).pending).toEqual(partlyResolved);
  expect(useVcsStore.getState().pending?.result.conflicts.map(item => item.kind)).toEqual(["overlap"]);
  resolveFirst("a");
  const resolved = restore(save()).pending;
  expect(resolved?.result.clean).toBe(true);
  expect(resolved?.resolutions).toHaveLength(2);
  useVcsStore.getState().commitMerge("Reviewed title and timing");
  const committed = restore(save());
  expect(committed.pending).toBeNull();
  expect(committed.repo.commits[committed.repo.branches.main!]!.parents).toEqual(["c4", "c5"]);
});
it.each(["base", "head", "target", "working", "choice", "key", "duplicate", "malformed"])("recovers the project while discarding invalid %s merge state", mode => {
  useVcsStore.getState().beginMerge("alternate");
  resolveFirst("a");
  const saved = JSON.parse(save());
  const repo = saved.repo;
  if (mode === "base") saved.pending.baseId = "missing";
  if (mode === "head") saved.pending.theirsId = "c0";
  if (mode === "target") saved.pending.targetBranch = "alternate";
  if (mode === "working") saved.pending.workingTimeline.id = "stale";
  if (mode === "choice") saved.pending.resolutions[0].choice = "ours";
  if (mode === "key") saved.pending.resolutions[0].key = "gone";
  if (mode === "duplicate") saved.pending.resolutions.push(saved.pending.resolutions[0]);
  if (mode === "malformed") saved.pending.resolutions = "broken";
  const recovered = deserializeProject(JSON.stringify(saved));
  expect(recovered.pending).toBeNull();
  expect(recovered.mergeRecovery).toMatch(/could not be restored/);
  expect(recovered.repo).toEqual(repo);
  expect(recovered.history).toEqual(saved.history);
});
it("supports legacy saves and explicit cancellation without changing committed history", () => {
  useVcsStore.getState().beginMerge("alternate");
  const repo = useVcsStore.getState().repo;
  useVcsStore.getState().cancelMerge();
  expect(restore(save()).repo).toEqual(repo);
  expect(useVcsStore.getState().pending).toBeNull();
  const legacy = JSON.parse(save()); delete legacy.pending;
  expect(deserializeProject(JSON.stringify(legacy)).pending).toBeNull();
});
it("rejects stale and repeated resolution commands without changing pending choices", () => {
  useVcsStore.getState().beginMerge("alternate");
  const before = useVcsStore.getState().pending;
  expect(() => resolveFirst("ours")).toThrow(/choice/);
  expect(useVcsStore.getState().pending).toBe(before);
  resolveFirst("a");
  const chosen = useVcsStore.getState().pending;
  const first = before!.result.conflicts[0]!;
  expect(() => useVcsStore.getState().resolveConflict(conflictKey(first), "b")).toThrow(/no longer/);
  expect(useVcsStore.getState().pending).toBe(chosen);
  useEditorStore.getState().dispatch({type: "renameProject", name: "New work"});
  expect(restore(save()).mergeRecovery).toMatch(/changed/);
  expect(useEditorStore.getState().timeline.id).toBe("New work");
});
