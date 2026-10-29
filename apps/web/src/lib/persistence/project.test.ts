import { describe, expect, it } from "vitest";
import {
  type Timeline,
  type Op,
  createHistory, current, record, undo, redo,
  applyOps,
  emptyTimeline,
  fromOTIO,
  toOTIO,
  makeClip,
  putAsset,
} from "@cutroom/engine";
import { type Commit, type Repo, commit, createBranch, createRepo, checkout, viewCommit } from "../vcs";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectLoadError,
  deserializeProject,
  isOp,
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


it("round-trips detached audio with its atomic undo and redo history", () => {
  const base = baseTimeline();
  const history = record(createHistory(base), { type: "detachAudio", clipId: "a", trackId: "a1" }, "alice");
  const loaded = deserializeProject(serializeProject({ history, repo: createRepo(base, "alice") }));
  const restored = toHistory(loaded.history);
  expect(current(restored).clips["audio:a"]?.volume).toBe(1);
  expect(current(restored).clips.a?.volume).toBe(0);
  expect(current(undo(restored))).toEqual(base);
  expect(current(redo(undo(restored)))).toEqual(current(history));
});

it.each([0.5, 99, NaN])("rejects invalid cursor %s instead of silently truncating replay", cursor => {
  const base = baseTimeline();
  const serialized = serializeProject({ history: { base, log: [], cursor }, repo: createRepo(base, "tester") });
  expect(() => deserializeProject(serialized)).toThrow(ProjectLoadError);
});
it("rejects missing current branch and detached commits", () => {
  const base = baseTimeline();
  const repo = createRepo(base, "tester");
  for (const invalid of [{ ...repo, currentBranch: "missing" }, { ...repo, detachedAt: "missing" }]) {
    expect(() => deserializeProject(serializeProject({ history: createHistory(base), repo: invalid }))).toThrow(ProjectLoadError);
  }
});
it("rejects cyclic commit graphs before restoring them", () => {
  const base = baseTimeline();
  const repo = createRepo(base, "tester");
  const root = repo.commits.c0!;
  expect(() => deserializeProject(serializeProject({ history: createHistory(base), repo: { ...repo, commits: { c0: { ...root, parents: ["c0"] } } } }))).toThrow(ProjectLoadError);
});


function validProject() {
  const base = baseTimeline();
  return { version: PROJECT_SCHEMA_VERSION, history: createHistory(base), repo: createRepo(base, "tester") };
}
type TestProject = ReturnType<typeof validProject>;
const corruptProjects: readonly [string, (project: TestProject) => unknown][] = [
  ["empty base snapshot", p => ({ ...p, history: { ...p.history, base: {} } })],
  ["malformed commit snapshot", p => ({ ...p, repo: { ...p.repo, commits: { c0: { ...p.repo.commits.c0, timeline: {} } } } })],
  ["invalid clip timing", p => ({ ...p, history: { ...p.history, base: { ...p.history.base, clips: { a: { ...p.history.base.clips.a, outPoint: 7 } } } } })],
  ["mismatched clip identity", p => ({ ...p, history: { ...p.history, base: { ...p.history.base, clips: { a: { ...p.history.base.clips.a, id: "different" } } } } })],
  ["invalid track metadata", p => ({ ...p, history: { ...p.history, base: { ...p.history.base, tracks: [{ ...p.history.base.tracks[0], muted: "false" }] } } })],
  ["invalid asset metadata", p => ({ ...p, history: { ...p.history, base: { ...p.history.base, assets: { "asset-a": { ...p.history.base.assets["asset-a"], tags: [42] } } } } })],
  ["malformed commit metadata", p => ({ ...p, repo: { ...p.repo, commits: { c0: { ...p.repo.commits.c0, message: {} } } } })],
  ["coerced branch reference", p => ({ ...p, repo: { ...p.repo, branches: { main: ["c0"] } } })],
  ["unknown operation", p => ({ ...p, history: { ...p.history, log: [{ op: { type: "bogus" }, author: "a", seq: 0 }], cursor: 1 } })],
  ["malformed operation envelope", p => ({ ...p, history: { ...p.history, log: [{ op: { type: "renameProject", name: "next" }, author: {}, seq: -1 }], cursor: 1 } })],
];
it.each(corruptProjects)("rejects %s before restoring either store", (_name, corrupt) => {
  const raw = JSON.stringify(corrupt(validProject()));
  expect(() => deserializeProject(raw)).toThrow(ProjectLoadError);
});

it("restores structurally valid missing-media timelines for verification", () => {
  const base = { ...baseTimeline(), assets: {} };
  const restored = deserializeProject(serializeProject({ history: createHistory(base), repo: createRepo(base, "tester") }));
  expect(current(toHistory(restored.history))).toEqual(base);
});

const operationShapes: readonly Op[] = [
  { type: "addClip", clip: makeClip({ id: "c", assetId: "asset-a", trackId: "v1", start: 0, inPoint: 0, duration: 100, volume: 1 }) },
  { type: "addTrack", track: { id: "v2", kind: "video", name: "second", muted: false } },
  { type: "detachAudio", clipId: "a", trackId: "a1" },
  { type: "deleteClip", clipId: "a" },
  { type: "splitClip", clipId: "a", at: 1000 },
  { type: "trimClip", clipId: "a", duration: 2000 },
  { type: "moveClip", clipId: "a", start: 1000, trackId: "v1" },
  { type: "setVolume", clipId: "a", volume: 0.5 },
  { type: "setTransform", clipId: "a", x: 20, scaleX: 2 },
  { type: "setFrameRate", fps: 25 },
  { type: "renameProject", name: "next" },
];
it.each(operationShapes)("recognizes the persisted $type operation shape", op => {
  expect(isOp(JSON.parse(JSON.stringify(op)))).toBe(true);
});
it.each([
  null, {}, { type: "bogus" }, { type: "addClip", clip: {} },
  { type: "addTrack", track: { id: "v2", kind: "video" } },
  { type: "detachAudio", clipId: "a", trackId: 4 },
  { type: "deleteClip", clipId: null }, { type: "splitClip", clipId: "a", at: "1000" },
  { type: "trimClip", clipId: "a", duration: null },
  { type: "moveClip", clipId: "a", start: 0, trackId: 42 },
  { type: "setVolume", clipId: "a", volume: NaN },
  { type: "setTransform", clipId: "a", x: "20" },
  { type: "setFrameRate", fps: "25" }, { type: "renameProject", name: null },
])("rejects incomplete or mistyped persisted operation %#", op => {
  expect(isOp(op)).toBe(false);
});
it("validates the redo tail even when the current cursor precedes it", () => {
  const project = validProject();
  const raw = JSON.stringify({ ...project, history: { ...project.history, log: [
    { op: { type: "renameProject", name: "valid" }, author: "tester", seq: 0 },
    { op: { type: "moveClip", clipId: "absent", start: 0 }, author: "tester", seq: 1 },
  ], cursor: 1 } });
  expect(() => deserializeProject(raw)).toThrow(/unusable op log/);
});

it("restores fractional frame rates preserved by the OTIO adapter", () => {
  const imported = fromOTIO(toOTIO({ ...baseTimeline(), fps: 29.97 }));
  expect(imported.fps).toBe(29.97);
  const restored = deserializeProject(serializeProject({ history: createHistory(imported), repo: createRepo(imported, "tester") }));
  expect(current(toHistory(restored.history))).toEqual(imported);
  expect(restored.repo.commits.c0?.timeline.fps).toBe(29.97);
});
