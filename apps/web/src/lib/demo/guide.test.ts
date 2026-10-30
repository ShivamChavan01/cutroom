import {beforeEach, expect, it} from "vitest";
import {applyOp, conflictKey, current} from "@cutroom/engine";
import {describeDemo} from "./guide";
import {createDemoProject} from "./project";
import {installDemoProject} from "./load";
import {useEditorStore} from "../../store";
import {useVcsStore} from "../../vcsStore";
import {head} from "../vcs";

beforeEach(() => installDemoProject());
function view(rail: "media" | "versions" | "issues" = "media", tab: "timeline" | "verification" = "timeline") {
  const {repo, pending, diffOverlay} = useVcsStore.getState();
  if (repo === null) throw new Error("Expected sample");
  return describeDemo({repo, pending, diff: diffOverlay, timeline: useEditorStore.getState().timeline, rail, tab});
}
it("derives intro, versions, and comparison from real UI and diff state", () => {
  expect(view().kind).toBe("intro");
  expect(view("versions").kind).toBe("versions");
  const vcs = useVcsStore.getState(), repo = vcs.repo!;
  vcs.setDiff(head(repo).timeline, "main", head(repo, "alternate").timeline, "alternate");
  expect(view().kind).toBe("compare");
  vcs.setDiff(head(repo).timeline, "same", head(repo).timeline, "same");
  expect(view().kind).toBe("comparison");
});
it("recognizes manual resolutions and a completed merge even after later commits", () => {
  const vcs = useVcsStore.getState();
  vcs.beginMerge("alternate");
  expect(view().kind).toBe("conflict");
  const conflict = useVcsStore.getState().pending!.result.conflicts[0]!;
  vcs.resolveConflict(conflictKey(conflict), "a");
  expect(view().kind).toBe("resolved");
  vcs.commitMerge("Combine cuts");
  expect(view().kind).toBe("merged");
  useEditorStore.getState().dispatch({type: "setVolume", clipId: "score", volume: .4});
  vcs.commitCurrent("Adjust sound");
  expect(view().kind).toBe("merged");
  expect(view("issues", "verification").kind).toBe("findings");
});
it("recognizes manual editing, stale merges, cancellation and branch/detached views", () => {
  const vcs = useVcsStore.getState();
  vcs.checkoutBranch("alternate"); expect(view().kind).toBe("return");
  vcs.viewCommit("c1"); expect(view().kind).toBe("return");
  vcs.checkoutBranch("main");
  useEditorStore.getState().dispatch({type: "renameProject", name: "My variation"});
  expect(view().kind).toBe("changed");
  useEditorStore.getState().undo(); vcs.beginMerge("alternate");
  useEditorStore.getState().dispatch({type: "renameProject", name: "Later"});
  expect(view().kind).toBe("changed");
  expect(view().label).toBe("Review pending merge");
  vcs.cancelMerge(); expect(view().kind).toBe("changed");
  installDemoProject(); expect(view().kind).toBe("intro");
});
it("handles unavailable sample branches and changed metadata without pointing at a merge action", () => {
  const demo = createDemoProject();
  const timeline = current(demo.history);
  expect(describeDemo({repo: {...demo.repo, branches: {main: "c2"}}, timeline, pending: null, diff: null, rail: "versions", tab: "timeline"}).kind).toBe("changed");
  expect(describeDemo({repo: demo.repo, timeline: applyOp(timeline, {type: "setFrameRate", fps: 24}), pending: null, diff: null, rail: "versions", tab: "timeline"}).label).toBe("Open versions");
});

it("does not call a project-setting disagreement a timing overlap", async () => {
  const {emptyTimeline} = await import("@cutroom/engine");
  const {createRepo, createBranch, checkout, commit} = await import("../vcs");
  const {startMerge} = await import("../mergeSession");
  const base = {...emptyTimeline(), fps: 30};
  let repo = createBranch(createRepo(base, "reviewer"), "alternate");
  repo = commit(repo, {...base, fps: 25}, "ours", "A");
  repo = checkout(repo, "alternate");
  repo = commit(repo, {...base, fps: 24}, "theirs", "B");
  repo = checkout(repo, "main");
  const timeline = head(repo).timeline;
  const description = describeDemo({repo, timeline, pending: startMerge(repo, timeline, "alternate"), diff: null, rail: "versions", tab: "merge"});
  expect(description.title).toBe("These editing decisions need your review");
  expect(description.text).not.toContain("overlap");
});

it("recognizes a merge after both sample branches have further commits", () => {
  const vcs = useVcsStore.getState();
  useEditorStore.getState().dispatch({type: "renameProject", name: "Our title"});
  vcs.commitCurrent("Our title");
  vcs.checkoutBranch("alternate");
  useEditorStore.getState().dispatch({type: "renameProject", name: "Their title"});
  vcs.commitCurrent("Their title");
  vcs.checkoutBranch("main"); vcs.beginMerge("alternate");
  for (const conflict of [...useVcsStore.getState().pending!.result.conflicts]) {
    vcs.resolveConflict(conflictKey(conflict), conflict.kind === "overlap" ? "a" : "ours");
  }
  vcs.commitMerge("Combine revised cuts");
  expect(view().kind).toBe("merged");
});
