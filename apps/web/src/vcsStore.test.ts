import { beforeEach, expect, it } from "vitest";
import { emptyTimeline } from "@cutroom/engine";
import { useEditorStore } from "./store";
import { useVcsStore } from "./vcsStore";

beforeEach(() => {
  useEditorStore.getState().loadTimeline(emptyTimeline("working"));
  useVcsStore.setState({ repo: null, pending: null, diffOverlay: null });
  useVcsStore.getState().ensureRepo();
  useVcsStore.getState().createBranch("feature");
});
it.each(["checkoutBranch", "viewCommit"] as const)("%s cannot discard dirty work", action => {
  useEditorStore.getState().dispatch({ type: "renameProject", name: "Unsaved" });
  const before = useEditorStore.getState();
  const repo = useVcsStore.getState().repo;
  expect(() => useVcsStore.getState()[action](action === "viewCommit" ? "c0" : "feature")).toThrow(/uncommitted/i);
  expect(useEditorStore.getState()).toBe(before);
  expect(useVcsStore.getState().repo).toBe(repo);
});
it("reports detached commit failures", () => {
  useVcsStore.getState().viewCommit("c0");
  expect(() => useVcsStore.getState().commitCurrent("edit")).toThrow(/detached/i);
});
it("refuses a merge commit after working edits changed during resolution", () => {
  useVcsStore.getState().beginMerge("feature");
  useEditorStore.getState().dispatch({ type: "renameProject", name: "Later edit" });
  expect(() => useVcsStore.getState().commitMerge("merge")).toThrow(/changed/i);
  expect(useEditorStore.getState().timeline.id).toBe("Later edit");
  expect(useVcsStore.getState().pending).not.toBeNull();
});
it("preserves edits when forking then commits, switches, views, and returns", () => {
  const store = useVcsStore.getState();
  useEditorStore.getState().dispatch({ type: "renameProject", name: "Feature cut" });
  store.forkBranch("cut");
  expect(useEditorStore.getState().timeline.id).toBe("Feature cut");
  store.commitCurrent("Feature cut");
  const saved = useEditorStore.getState().timeline;
  store.checkoutBranch("main");
  expect(useEditorStore.getState().timeline.id).toBe("working");
  store.checkoutBranch("cut");
  expect(useEditorStore.getState().timeline).toEqual(saved);
  store.viewCommit("c0");
  expect(useVcsStore.getState().repo?.detachedAt).toBe("c0");
  store.checkoutBranch("cut");
  expect(useEditorStore.getState().timeline).toEqual(saved);
});
it("cancel keeps the working history and merge commit records both parents", () => {
  const store = useVcsStore.getState();
  store.checkoutBranch("feature");
  useEditorStore.getState().dispatch({ type: "setFrameRate", fps: 25 });
  store.commitCurrent("fps");
  store.checkoutBranch("main");
  useEditorStore.getState().dispatch({ type: "renameProject", name: "Our work" });
  const history = useEditorStore.getState().history;
  store.beginMerge("feature");
  expect(() => store.checkoutBranch("feature")).toThrow(/merge/);
  expect(() => store.viewCommit("c0")).toThrow(/merge/);
  expect(() => store.forkBranch("abandon")).toThrow(/merge/);
  expect(() => store.commitCurrent("bad")).toThrow(/merge/);
  store.cancelMerge();
  expect(useEditorStore.getState().history).toBe(history);
  store.beginMerge("feature");
  store.commitMerge("merge fps");
  const repo = useVcsStore.getState().repo!;
  expect(repo.commits[repo.branches.main!]?.parents).toEqual(["c0", "c1"]);
  expect(useEditorStore.getState().timeline).toMatchObject({ id: "Our work", fps: 25 });
  expect(useVcsStore.getState().pending).toBeNull();
});
it("does not trust a clean flag with unresolved conflicts", () => {
  const store = useVcsStore.getState();
  store.beginMerge("feature");
  const r = useVcsStore.getState().pending!.result;
  useVcsStore.setState({pending: {...useVcsStore.getState().pending!, result: { ...r, clean: true, conflicts: [{ kind: "project", field: "fps", base: 30, ours: 25, theirs: 24 }] }}});
  expect(() => store.commitMerge("bad")).toThrow(/conflicts/);
});
it("invalid checkouts and branch names do not mutate the stores", () => {
  const before = useVcsStore.getState();
  const editor = useEditorStore.getState();
  expect(() => before.checkoutBranch("missing")).toThrow(/no branch/);
  expect(() => before.viewCommit("missing")).toThrow(/no commit/);
  expect(() => before.forkBranch("feature")).toThrow(/already exists/);
  expect(useVcsStore.getState()).toBe(before);
  expect(useEditorStore.getState()).toBe(editor);
});
