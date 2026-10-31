import {expect, it} from "vitest";
import {applyOp, createHistory, current, emptyTimeline, makeClip, mergeTimelines, putAsset, record, redo, splitChildId, undo} from "@cutroom/engine";
import {clipAuthors} from "./clipAuthors";
import {checkout, commit, createBranch, createRepo, head, viewCommit, type Commit} from "./vcs";
import {createDemoProject} from "./demo/project";
import {deserializeProject, serializeProject} from "./persistence/project";

function fixture() {
  let timeline = putAsset(emptyTimeline("Authorship"), {id: "source", kind: "video", duration: 8000});
  for (const [id, start] of [["a", 0], ["b", 3000]] as const) timeline = applyOp(timeline, {type: "addClip", clip: makeClip({id, trackId: "v1", assetId: "source", start, inPoint: 0, duration: 1000, volume: 1})});
  return {timeline, repo: createRepo(timeline, "Alice")};
}
function known(repo: ReturnType<typeof createRepo>) {
  const timeline = repo.detachedAt === null ? head(repo).timeline : repo.commits[repo.detachedAt]!.timeline;
  return clipAuthors(repo, createHistory(timeline), timeline);
}
it("preserves actual sample authors after discarding the working log on checkout", () => {
  const {repo, history} = createDemoProject(), timeline = current(history);
  const expected = new Map([["opening", "Editor A"], ["middle", "Editor A"], ["ending", "Demo"], ["score", "Demo"]]);
  expect(clipAuthors(repo, history, timeline)).toEqual(expected);
  expect(known(repo)).toEqual(expected);
  expect(known(checkout(repo, "alternate")).get("ending")).toBe("Editor B");
});
it("uses the last clip-changing commit and ignores project, tag and empty commits", () => {
  const {timeline, repo: root} = fixture();
  let repo = commit(root, applyOp(timeline, {type: "moveClip", clipId: "a", start: 500}), "Moved", "Bob");
  repo = commit(repo, applyOp(head(repo).timeline, {type: "renameProject", name: "Renamed"}), "Name", "Carol");
  repo = commit(repo, applyOp(head(repo).timeline, {type: "setAssetTags", assetId: "source", tags: ["tag"]}), "Tags", "Dave");
  repo = commit(repo, head(repo).timeline, "Empty", "Eve");
  expect(known(repo)).toEqual(new Map([["a", "Bob"], ["b", "Alice"]]));
});
it("detached inspection uses that commit rather than the newer branch head", () => {
  const {timeline, repo: root} = fixture();
  const repo = commit(root, applyOp(timeline, {type: "moveClip", clipId: "a", start: 500}), "Moved", "Bob");
  expect(known(viewCommit(repo, "c0")).get("a")).toBe("Alice");
  expect(known(repo).get("a")).toBe("Bob");
});
it("working authors follow latest active operations and recover committed/base authors through undo/redo", () => {
  const {timeline, repo} = fixture();
  let history = record(createHistory(timeline), {type: "moveClip", clipId: "a", start: 500}, "Bob");
  history = record(history, {type: "setVolume", clipId: "a", volume: .5}, "Carol");
  expect(clipAuthors(repo, history, current(history)).get("a")).toBe("Carol");
  history = undo(history); expect(clipAuthors(repo, history, current(history)).get("a")).toBe("Bob");
  history = undo(history); expect(clipAuthors(repo, history, current(history)).get("a")).toBe("Alice");
  history = redo(history); const committed = commit(repo, current(history), "Moved", "Bob");
  expect(clipAuthors(committed, undo(history), current(undo(history))).get("a")).toBe("Alice");
  expect(clipAuthors(committed, history, current(history)).get("a")).toBe("Bob");
});
it("committed snapshots are authoritative even when their old working log has different authors", () => {
  const {timeline, repo} = fixture();
  const history = record(createHistory(timeline), {type: "moveClip", clipId: "a", start: 500}, "Operation author");
  const committed = commit(repo, current(history), "Reviewed commit", "Commit author");
  expect(clipAuthors(committed, history, current(history)).get("a")).toBe("Commit author");
});
it("keeps each merge parent's attribution when a clip is taken unchanged from it", () => {
  const {timeline, repo: root} = fixture(); let repo = createBranch(root, "feature");
  repo = commit(repo, applyOp(timeline, {type: "moveClip", clipId: "a", start: 500}), "Our a", "Bob");
  const ours = head(repo); repo = checkout(repo, "feature");
  repo = commit(repo, applyOp(timeline, {type: "moveClip", clipId: "b", start: 4000}), "Their b", "Carol");
  const theirs = head(repo), result = mergeTimelines(timeline, ours.timeline, theirs.timeline);
  expect(result.clean).toBe(true); repo = checkout(repo, "main");
  repo = commit(repo, result.merged, "Joined", "Merger", [ours.id, theirs.id]);
  expect(known(repo)).toEqual(new Map([["a", "Bob"], ["b", "Carol"]]));
});
it("credits a newly combined merge snapshot to its merge author without inventing field-level blame", () => {
  const {timeline, repo: root} = fixture(); let repo = createBranch(root, "feature");
  repo = commit(repo, applyOp(timeline, {type: "setVolume", clipId: "a", volume: .5}), "Our gain", "Bob");
  const ours = head(repo); repo = checkout(repo, "feature");
  repo = commit(repo, applyOp(timeline, {type: "moveClip", clipId: "a", start: 500}), "Their position", "Carol");
  const theirs = head(repo), result = mergeTimelines(timeline, ours.timeline, theirs.timeline);
  expect(result.clean).toBe(true); repo = checkout(repo, "main");
  repo = commit(repo, result.merged, "Combined a", "Merger", [ours.id, theirs.id]);
  expect(known(repo)).toEqual(new Map([["a", "Merger"], ["b", "Alice"]]));
});
it("uses first-parent attribution when independently identical parent clips both match", () => {
  const {timeline, repo: root} = fixture(); let repo = createBranch(root, "feature");
  const changed = applyOp(timeline, {type: "moveClip", clipId: "a", start: 500});
  repo = commit(repo, changed, "Our edit", "Bob"); const ours = head(repo);
  repo = commit(checkout(repo, "feature"), changed, "Same independent edit", "Carol"); const theirs = head(repo);
  repo = commit(checkout(repo, "main"), changed, "Converged", "Merger", [ours.id, theirs.id]);
  expect(known(repo).get("a")).toBe("Bob");
});
it("recreated IDs get their new creator and split descendants survive history restoration", () => {
  const {timeline, repo: root} = fixture();
  const deleted = commit(root, applyOp(timeline, {type: "deleteClip", clipId: "a"}), "Delete a", "Bob");
  const recreated = commit(deleted, timeline, "New a", "Carol"); expect(known(recreated).get("a")).toBe("Carol");
  const history = record(createHistory(timeline), {type: "splitClip", clipId: "a", at: 500}, "Splitter");
  const splitRepo = commit(root, current(history), "Split", "Splitter");
  const restored = deserializeProject(serializeProject({repo: splitRepo, history: createHistory(head(splitRepo).timeline)}));
  expect(clipAuthors(restored.repo, restored.history, current(restored.history)).get(splitChildId("a", 500, "R"))).toBe("Splitter");
});
it("does not invent attribution for unknown snapshots or without repository/history evidence", () => {
  const {timeline, repo} = fixture(), history = createHistory(timeline);
  expect(clipAuthors(null, history, timeline).size).toBe(0);
  const changed = applyOp(timeline, {type: "moveClip", clipId: "a", start: 777});
  expect(clipAuthors(repo, createHistory(changed), changed).has("a")).toBe(false);
  expect(clipAuthors(repo, createHistory(changed), changed).get("b")).toBe("Alice");
});
it("is iterative over deep histories, ignores timestamps and never mutates snapshots", () => {
  const {timeline} = fixture(), commits: Record<string, Commit> = {};
  for (let i = 0; i < 12000; i++) commits[`n${i}`] = {id: `n${i}`, timeline, parents: i ? [`n${i-1}`] : [], at: 12000-i, author: i ? "Metadata only" : "Original", message: "Fixture"};
  const repo = {commits, branches: {main: "n11999"}, currentBranch: "main", detachedAt: null};
  const before = JSON.stringify(repo);
  expect(known(repo)).toEqual(new Map([["a", "Original"], ["b", "Original"]]));
  expect(known(repo)).toEqual(new Map([["a", "Original"], ["b", "Original"]]));
  expect(JSON.stringify(repo)).toBe(before);
}, 30000);
