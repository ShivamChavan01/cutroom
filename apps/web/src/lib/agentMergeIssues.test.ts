import {beforeEach, expect, it} from "vitest";
import {conflictKey} from "@cutroom/engine";
import {installDemoProject} from "./demo/load";
import {useEditorStore} from "../store";
import {useVcsStore} from "../vcsStore";
import {head} from "./vcs";
import {deserializeProject, serializeProject} from "./persistence/project";

beforeEach(() => installDemoProject());
it.each(["start", "volume", "name"])("#3 blocks dirty %s edits without changing either store", kind => {
  const editor = useEditorStore.getState();
  if (kind === "start") editor.dispatch({type: "moveClip", clipId: "opening", start: 500});
  if (kind === "volume") editor.dispatch({type: "setVolume", clipId: "score", volume: .2});
  if (kind === "name") editor.dispatch({type: "renameProject", name: "Unsaved title"});
  const before = useEditorStore.getState();
  const vcs = useVcsStore.getState();
  expect(() => vcs.beginMerge("alternate")).toThrow(/commit.*changes|uncommitted/i);
  expect(useVcsStore.getState()).toBe(vcs);
  expect(useEditorStore.getState()).toBe(before);
});
it("#4 treats an already merged source as an idempotent no-op after restore and later commits", () => {
  const vcs = useVcsStore.getState();
  vcs.beginMerge("alternate");
  const conflict = useVcsStore.getState().pending!.result.conflicts[0]!;
  vcs.resolveConflict(conflictKey(conflict), "a"); vcs.commitMerge("Merged");
  useEditorStore.getState().dispatch({type: "setVolume", clipId: "score", volume: .4});
  vcs.commitCurrent("Later edit");
  const repo = useVcsStore.getState().repo!;
  const restored = deserializeProject(serializeProject({repo, history: useEditorStore.getState().history}));
  vcs.restoreRepo(restored.repo);
  const history = useEditorStore.getState().history;
  vcs.beginMerge("alternate");
  expect(useVcsStore.getState().pending).toBeNull();
  expect(useVcsStore.getState().repo).toEqual(repo);
  expect(useEditorStore.getState().history).toBe(history);
});
it.each([1, 3])("#1 fast-forwards across %i commits without making a new commit", count => {
  const vcs = useVcsStore.getState();
  vcs.createBranch("ahead"); vcs.checkoutBranch("ahead");
  for (let i = 0; i < count; i++) {
    useEditorStore.getState().dispatch({type: "moveClip", clipId: "opening", start: (i + 1) * 250});
    vcs.commitCurrent(`Edit ${i}`);
  }
  const expected = head(useVcsStore.getState().repo!).timeline;
  const sourceHead = head(useVcsStore.getState().repo!).id;
  const numberOfCommits = Object.keys(useVcsStore.getState().repo!.commits).length;
  vcs.checkoutBranch("main"); vcs.beginMerge("ahead");
  expect(useVcsStore.getState().pending).toBeNull();
  expect(useVcsStore.getState().repo!.branches.main).toBe(sourceHead);
  expect(Object.keys(useVcsStore.getState().repo!.commits)).toHaveLength(numberOfCommits);
  expect(useEditorStore.getState().timeline).toEqual(expected);
});

it("blocks a dirty fast-forward and a dirty restored working copy", () => {
  const vcs = useVcsStore.getState();
  vcs.createBranch("ahead"); vcs.checkoutBranch("ahead");
  useEditorStore.getState().dispatch({type: "setVolume", clipId: "score", volume: .1});
  vcs.commitCurrent("Ahead"); vcs.checkoutBranch("main");
  useEditorStore.getState().dispatch({type: "setAssetTags", assetId: Object.keys(useEditorStore.getState().timeline.assets)[0]!, tags: ["uncommitted"]});
  const repo = useVcsStore.getState().repo!;
  const history = useEditorStore.getState().history;
  const restored = deserializeProject(serializeProject({repo, history}));
  useEditorStore.getState().restoreHistory(restored.history); vcs.restoreRepo(restored.repo);
  expect(() => vcs.beginMerge("ahead")).toThrow(/uncommitted/);
  expect(useEditorStore.getState().timeline.assets[Object.keys(repo.commits.c2!.timeline.assets)[0]!]!.tags).toEqual(["uncommitted"]);
  expect(useVcsStore.getState().repo!.branches.main).toBe("c2");
});
it("treats identical heads as already up to date", () => {
  const vcs = useVcsStore.getState(); vcs.createBranch("same");
  const before = useVcsStore.getState();
  expect(vcs.beginMerge("same")).toBe("up-to-date");
  expect(useVcsStore.getState()).toBe(before);
});
it("uses ancestry even when the source commit has an older date and non-sequential ID", () => {
  const vcs = useVcsStore.getState();
  vcs.createBranch("ahead"); vcs.checkoutBranch("ahead");
  useEditorStore.getState().dispatch({type: "setVolume", clipId: "score", volume: .4});
  vcs.commitCurrent("Ahead");
  const original = useVcsStore.getState().repo!, source = head(original);
  vcs.checkoutBranch("main");
  const repo = useVcsStore.getState().repo!;
  vcs.restoreRepo({...repo, commits: {...repo.commits, "older-name": {...source, id: "older-name", at: 0}}, branches: {...repo.branches, ahead: "older-name"}});
  expect(vcs.beginMerge("ahead")).toBe("fast-forward");
  expect(useVcsStore.getState().repo!.branches.main).toBe("older-name");
});

it.each([false, true])("recovers an obsolete pending ancestor session without moving history (source ahead: %s)", ahead => {
  const vcs = useVcsStore.getState();
  vcs.createBranch("source");
  if (ahead) {
    vcs.checkoutBranch("source");
    useEditorStore.getState().dispatch({type: "setVolume", clipId: "score", volume: .4});
    vcs.commitCurrent("Ahead"); vcs.checkoutBranch("main");
  }
  const repo = useVcsStore.getState().repo!, history = useEditorStore.getState().history;
  const raw = JSON.parse(serializeProject({repo, history}));
  raw.pending = {targetBranch: "main", sourceBranch: "source", baseId: repo.branches.main,
    oursId: repo.branches.main, theirsId: repo.branches.source, workingTimeline: head(repo).timeline, resolutions: []};
  const restored = deserializeProject(JSON.stringify(raw));
  expect(restored.pending).toBeNull();
  expect(restored.mergeRecovery).toMatch(/do not need a pending merge/);
  expect(restored.repo).toEqual(repo);
  expect(restored.history).toEqual(history);
});

it("recovers an old dirty pending session while preserving its uncommitted work", () => {
  const vcs = useVcsStore.getState();
  useEditorStore.getState().dispatch({type: "moveClip", clipId: "opening", start: 500});
  const repo = vcs.repo!, history = useEditorStore.getState().history;
  const raw = JSON.parse(serializeProject({repo, history}));
  raw.pending = {targetBranch: "main", sourceBranch: "alternate", baseId: "c1", oursId: "c2", theirsId: "c3",
    workingTimeline: useEditorStore.getState().timeline, resolutions: []};
  const restored = deserializeProject(JSON.stringify(raw));
  expect(restored.pending).toBeNull();
  expect(restored.mergeRecovery).toMatch(/uncommitted changes/);
  expect(restored.repo).toEqual(repo);
  expect(restored.history).toEqual(history);
});
