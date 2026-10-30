import { describe, expect, it } from "vitest";
import { current, diffTimelines, lint, mergeTimelines, undo, redo, clipIsWellFormed } from "@cutroom/engine";
import { createDemoProject, demoMediaUrls, DEMO_BRANCH, DEMO_VIDEO_ID } from "./project";
import { head, findMergeBase, resolveOverlap } from "../vcs";
import { deserializeProject, serializeProject, toHistory, toRepo } from "../persistence/project";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

describe("real demo project", () => {
  it("builds deterministic reducer history, multiple commits, and two valid versions", () => {
    const first = createDemoProject();
    expect(first).toEqual(createDemoProject());
    expect(Object.keys(first.repo.commits)).toHaveLength(4);
    expect(Object.keys(first.repo.branches)).toEqual(["main", DEMO_BRANCH]);
    expect(current(first.history)).toEqual(head(first.repo).timeline);
    expect(current(redo(undo(first.history)))).toEqual(current(first.history));
    for (const entry of Object.values(first.repo.commits)) {
      for (const clip of Object.values(entry.timeline.clips)) {
        expect(clipIsWellFormed(clip)).toBe(true);
        expect(entry.timeline.assets[clip.assetId]).toBeDefined();
        expect(entry.timeline.tracks.some((track) => track.id === clip.trackId)).toBe(true);
      }
      expect(lint(entry.timeline).filter((finding) => finding.rule === "overlap")).toEqual([]);
    }
  });
  it("produces an actual geometric conflict between otherwise valid independent edits", () => {
    const {repo} = createDemoProject();
    const ours = head(repo); const theirs = head(repo, DEMO_BRANCH);
    const base = findMergeBase(repo, ours.id, theirs.id);
    expect(base?.id).toBe("c1");
    const result = mergeTimelines(base!.timeline, ours.timeline, theirs.timeline);
    expect(result.clean).toBe(false);
    expect(result.conflicts.map((item) => item.kind)).toEqual(["overlap"]);
    const conflict = result.conflicts[0]!;
    if (conflict.kind !== "overlap") throw new Error("Expected a geometric overlap");
    const resolved = resolveOverlap(result, conflict.a, conflict.b);
    expect(resolved.clean).toBe(true);
    expect(resolved.conflicts).toEqual([]);
    expect(lint(resolved.merged).some((finding) => finding.rule === "gap")).toBe(true);
    const differences = diffTimelines(repo.commits.c1!.timeline, ours.timeline);
    expect(differences.changes.some((change) => change.kind === "moved")).toBe(true);
    expect(differences.changes.some((change) => change.kind === "trimmed")).toBe(true);
  });
  it("round-trips through the actual persisted project schema", () => {
    const demo = createDemoProject();
    const restored = deserializeProject(serializeProject(demo));
    expect(toRepo(restored.repo)).toEqual(demo.repo);
    expect(current(toHistory(restored.history))).toEqual(current(demo.history));
    expect(lint(current(demo.history)).some((finding) => finding.rule === "gap")).toBe(true);
  });
  it("ships small real media whose IDs match the bytes, with base-path-safe URLs", () => {
    const urls = demoMediaUrls("/cutroom/");
    expect(urls.get(DEMO_VIDEO_ID)).toBe("/cutroom/demo/motion.mp4");
    for (const [id, url] of urls) {
      const path = new URL(`../../../public/${url.replace("/cutroom/", "")}`, import.meta.url);
      expect(statSync(path).size).toBeLessThan(300000);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(id);
    }
  });
});

it("installs and resets the sample through the real stores without mutating the fixture", async () => {
  const { installDemoProject } = await import("./load");
  const { useEditorStore } = await import("../../store");
  const { useVcsStore } = await import("../../vcsStore");
  installDemoProject();
  const snapshot = JSON.stringify(useEditorStore.getState().timeline);
  useEditorStore.getState().dispatch({type: "deleteClip", clipId: "opening"});
  useVcsStore.getState().beginMerge(DEMO_BRANCH);
  expect(useVcsStore.getState().pending).not.toBeNull();
  installDemoProject();
  expect(JSON.stringify(useEditorStore.getState().timeline)).toBe(snapshot);
  expect(useVcsStore.getState().pending).toBeNull();
  expect(useVcsStore.getState().repo).toEqual(createDemoProject().repo);
});
