import { describe, expect, it } from "vitest";
import {
  type Timeline,
  applyOps,
  emptyTimeline,
  makeClip,
  putAsset,
} from "@cutroom/engine";
import { type Commit, type Repo, commit, createBranch, createRepo, checkout, viewCommit } from "../vcs";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectLoadError,
  deserializeProject,
  serializeProject,
  toHistory,
  toRepo,
} from "./project";

function baseTimeline(): Timeline {
  let t = emptyTimeline("persist");
  t = putAsset(t, { id: "asset-a", kind: "video", duration: 30_000 });
  return applyOps(t, [
    {
      type: "addClip",
      clip: makeClip({
        id: "a", trackId: "v1", assetId: "asset-a",
        start: 0, inPoint: 0, duration: 4_000, volume: 1,
      }),
    },
  ]);
}

function historyWithRedoTail() {
  let t = baseTimeline();
  t = applyOps(t, [{ type: "moveClip", clipId: "a", start: 1_000 }]);
  t = applyOps(t, [{ type: "setVolume", clipId: "a", volume: 0.5 }]);
  return {
    base: baseTimeline(),
    log: [
      { op: { type: "moveClip", clipId: "a", start: 1_000 } as const, author: "alice", seq: 0 },
      { op: { type: "setVolume", clipId: "a", volume: 0.5 } as const, author: "bob", seq: 1 },
    ],
    // Cursor sits before the last op: there is a redo tail to restore.
    cursor: 1,
  };
}

function repoWithMerge(): Repo {
  let repo = createRepo(baseTimeline(), "alice");
  repo = commit(repo, baseTimeline(), "base work", "alice");
  repo = createBranch(repo, "feature");
  repo = checkout(repo, "feature");
  repo = commit(repo, baseTimeline(), "feature work", "bob");
  repo = checkout(repo, "main");
  repo = commit(repo, baseTimeline(), "main work", "carol");
  const merged: Commit = {
    id: "c9",
    message: "merge feature",
    author: "alice",
    at: Date.now(),
    timeline: baseTimeline(),
    parents: ["c2", "c3"],
  };
  return {
    ...repo,
    commits: { ...repo.commits, c9: merged },
    branches: { ...repo.branches, main: "c9" },
  };
}

describe("project serialization", () => {
  it("round-trips a history that has a redo tail", () => {
    const history = historyWithRedoTail();
    const repo = createRepo(baseTimeline(), "alice");
    const raw = serializeProject({ history, repo });
    const parsed = deserializeProject(raw);

    expect(parsed.history.cursor).toBe(1);
    expect(parsed.history.log).toHaveLength(2);
    expect(parsed.history.log[1]?.author).toBe("bob");
    // The redo tail survives: the op after the cursor is still there.
    expect(parsed.history.log[parsed.history.cursor]?.op.type).toBe("setVolume");
  });

  it("round-trips merge commits with two parents", () => {
    const repo = repoWithMerge();
    const raw = serializeProject({
      history: { base: baseTimeline(), log: [], cursor: 0 },
      repo,
    });
    const parsed = deserializeProject(raw);

    const merge = parsed.repo.commits["c9"];
    expect(merge?.parents).toEqual(["c2", "c3"]);
  });

  it("round-trips a detached HEAD", () => {
    let repo = createRepo(baseTimeline(), "alice");
    repo = commit(repo, baseTimeline(), "second", "alice");
    repo = viewCommit(repo, "c0");
    const raw = serializeProject({
      history: { base: baseTimeline(), log: [], cursor: 0 },
      repo,
    });
    const parsed = deserializeProject(raw);

    expect(parsed.repo.detachedAt).toBe("c0");
  });

  it("round-trips several branches", () => {
    let repo = createRepo(baseTimeline(), "alice");
    repo = createBranch(repo, "one");
    repo = createBranch(repo, "two");
    repo = createBranch(repo, "three");
    const raw = serializeProject({
      history: { base: baseTimeline(), log: [], cursor: 0 },
      repo,
    });
    const parsed = deserializeProject(raw);

    expect(Object.keys(parsed.repo.branches).sort()).toEqual([
      "main", "one", "three", "two",
    ]);
  });

  it("round-trips asset metadata", () => {
    const raw = serializeProject({
      history: { base: baseTimeline(), log: [], cursor: 0 },
      repo: createRepo(baseTimeline(), "alice"),
    });
    const parsed = deserializeProject(raw);

    expect(parsed.history.base.assets["asset-a"]?.duration).toBe(30_000);
  });

  it("rebuilds an engine history and repo from the parsed form", () => {
    const history = historyWithRedoTail();
    const repo = createRepo(baseTimeline(), "alice");
    const parsed = deserializeProject(serializeProject({ history, repo }));

    const rebuilt = toHistory(parsed.history);
    expect(rebuilt.cursor).toBe(1);
    expect(rebuilt.log).toHaveLength(2);
    expect(toRepo(parsed.repo).currentBranch).toBe("main");
  });

  it("rejects an unknown schema version with a clear error", () => {
    const raw = JSON.stringify({ version: 999, history: {}, repo: {} });
    expect(() => deserializeProject(raw)).toThrow(/version 999/);
  });

  it("keeps the raw text on the error so it can be exported", () => {
    const raw = "not json at all";
    try {
      deserializeProject(raw);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectLoadError);
      expect((error as ProjectLoadError).raw).toBe(raw);
      expect((error as ProjectLoadError).message).toMatch(/not valid JSON/);
    }
  });

  it("rejects an op log the engine cannot replay", () => {
    const raw = JSON.stringify({
      version: PROJECT_SCHEMA_VERSION,
      history: {
        base: baseTimeline(),
        log: [
          { op: { type: "moveClip", clipId: "does-not-exist", start: 0 }, author: "x", seq: 0 },
        ],
        cursor: 1,
      },
      repo: {
        commits: { c0: { id: "c0", message: "m", author: "a", at: 0, timeline: baseTimeline(), parents: [] } },
        branches: { main: "c0" },
        currentBranch: "main",
        detachedAt: null,
      },
    });
    expect(() => deserializeProject(raw)).toThrow(/unusable op log/);
  });

  it("rejects a commit whose parent is missing", () => {
    const raw = JSON.stringify({
      version: PROJECT_SCHEMA_VERSION,
      history: { base: baseTimeline(), log: [], cursor: 0 },
      repo: {
        commits: {
          c0: { id: "c0", message: "m", author: "a", at: 0, timeline: baseTimeline(), parents: ["ghost"] },
        },
        branches: { main: "c0" },
        currentBranch: "main",
        detachedAt: null,
      },
    });
    expect(() => deserializeProject(raw)).toThrow(/missing parent ghost/);
  });

  it("rejects a branch pointing at a missing commit", () => {
    const raw = JSON.stringify({
      version: PROJECT_SCHEMA_VERSION,
      history: { base: baseTimeline(), log: [], cursor: 0 },
      repo: {
        commits: {},
        branches: { main: "nope" },
        currentBranch: "main",
        detachedAt: null,
      },
    });
    expect(() => deserializeProject(raw)).toThrow(/points at missing commit/);
  });

  it("rejects structurally broken data", () => {
    expect(() => deserializeProject("[]")).toThrow(/not an object/);
    expect(() => deserializeProject('{"version":1}')).toThrow(/no usable history/);
  });
});
