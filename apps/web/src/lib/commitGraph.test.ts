import { describe, expect, it } from "vitest";
import { type Timeline, emptyTimeline } from "@cutroom/engine";
import { buildCommitGraph, orderCommits } from "./commitGraph";
import { type Repo, commit, createBranch, createRepo, checkout } from "./vcs";

const empty: Timeline = emptyTimeline("graph");

function baseRepo(): Repo {
  return createRepo(empty, "alice");
}

describe("orderCommits", () => {
  it("puts the newest commit first and parents after children", () => {
    let repo = baseRepo();
    repo = commit(repo, empty, "second", "alice");
    const ordered = orderCommits(repo.commits);

    expect(ordered[0]?.message).toBe("second");
    expect(ordered[ordered.length - 1]?.id).toBe("c0");
  });

  it("keeps a merge after both of its parents' sides", () => {
    let repo = baseRepo();
    repo = commit(repo, empty, "main work", "alice");
    repo = createBranch(repo, "feature");
    repo = checkout(repo, "feature");
    repo = commit(repo, empty, "feature work", "bob");
    const ordered = orderCommits(repo.commits);
    const ids = ordered.map((c) => c.id);

    // c0 (root) is last; the two tips are before it.
    expect(ids[ids.length - 1]).toBe("c0");
    expect(ids.length).toBe(3);
  });
});

describe("buildCommitGraph", () => {
  it("gives a linear history one lane", () => {
    let repo = baseRepo();
    repo = commit(repo, empty, "second", "alice");
    repo = commit(repo, empty, "third", "alice");

    const graph = buildCommitGraph(repo);
    expect(graph.laneCount).toBe(1);
    expect(graph.nodes).toHaveLength(3);
    expect(new Set(graph.nodes.map((n) => n.lane)).size).toBe(1);
  });

  it("puts a branch on its own lane and merges back", () => {
    let repo = baseRepo();
    repo = commit(repo, empty, "main work", "alice");
    repo = createBranch(repo, "feature");
    repo = checkout(repo, "feature");
    repo = commit(repo, empty, "feature work", "bob");
    // Merge it back by hand: a commit with two parents.
    const merged = {
      ...repo,
      commits: {
        ...repo.commits,
        c9: {
          id: "c9",
          message: "merge feature",
          author: "alice",
          at: Date.now(),
          timeline: empty,
          parents: ["c1", "c2"],
        },
      },
      branches: { ...repo.branches, main: "c9" },
    };

    const graph = buildCommitGraph(merged);
    expect(graph.laneCount).toBeGreaterThan(1);
    // The merge commit has two edges: one to each parent.
    const mergeEdges = graph.edges.filter((edge) => edge.from === "c9");
    expect(mergeEdges).toHaveLength(2);
    expect(mergeEdges.map((edge) => edge.to).sort()).toEqual(["c1", "c2"]);
  });

  it("lists every branch tip", () => {
    let repo = baseRepo();
    repo = createBranch(repo, "feature");
    const graph = buildCommitGraph(repo);

    expect(graph.branchTips.map((tip) => tip.branch).sort()).toEqual([
      "feature",
      "main",
    ]);
  });

  it("assigns each commit a unique row", () => {
    let repo = baseRepo();
    repo = commit(repo, empty, "second", "alice");
    const graph = buildCommitGraph(repo);
    const rows = graph.nodes.map((n) => n.row);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it("keeps main in lane 0 and forks side branches to the right", () => {
    // The thing a graph must show: two lines of work, visibly separate.
    let repo = baseRepo();
    repo = commit(repo, empty, "base work", "alice");
    repo = createBranch(repo, "feature");
    repo = checkout(repo, "feature");
    repo = commit(repo, empty, "feature work", "bob");
    repo = checkout(repo, "main");

    const graph = buildCommitGraph(repo);
    const byId = new Map(graph.nodes.map((n) => [n.commit.id, n]));

    // main's tip is lane 0; the feature commit is to its right.
    const mainHead = repo.branches["main"]!;
    const featureHead = repo.branches["feature"]!;
    expect(byId.get(mainHead)?.lane).toBe(0);
    expect(byId.get(featureHead)?.lane).toBeGreaterThan(0);
    expect(graph.laneCount).toBeGreaterThan(1);
  });

  it("gives a branch with no commits of its own no lane", () => {
    // A branch pointing at a commit on the main line is not a fork.
    let repo = baseRepo();
    repo = commit(repo, empty, "base work", "alice");
    repo = createBranch(repo, "feature");

    const graph = buildCommitGraph(repo);
    expect(graph.laneCount).toBe(1);
    expect(graph.branchLane["feature"]).toBeUndefined();
  });

  it("tags the tail edge of a side branch so it can be drawn in its colour", () => {
    let repo = baseRepo();
    repo = commit(repo, empty, "base work", "alice");
    repo = createBranch(repo, "feature");
    repo = checkout(repo, "feature");
    repo = commit(repo, empty, "feature work", "bob");
    // Back to main, which now has a commit of its own: a real fork.
    repo = checkout(repo, "main");
    repo = commit(repo, empty, "main work", "carol");

    const graph = buildCommitGraph(repo);
    const tagged = graph.edges.filter((edge) => edge.branch !== undefined);
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.branch).toBe("feature");
  });

  it("shows the feature fork even while that branch is checked out", () => {
    // Same shape as the reported bug: main stops at the feature fork.
    let repo = baseRepo();
    repo = commit(repo, empty, "base work", "alice");
    repo = createBranch(repo, "feature");
    repo = checkout(repo, "feature");
    repo = commit(repo, empty, "feature work", "bob");

    const graph = buildCommitGraph(repo);
    expect(graph.laneCount).toBe(2);
    expect(graph.branchLane).toEqual({ main: 0, feature: 1 });
    expect(buildCommitGraph(checkout(repo, "main"))).toEqual(graph);
    expect(graph.edges).toContainEqual({ from: "c2", to: "c1", branch: "feature" });
  });

  it("records which lane each branch runs in", () => {
    let repo = baseRepo();
    repo = createBranch(repo, "feature");
    const graph = buildCommitGraph(repo);
    expect(graph.branchLane["main"]).toBe(0);
  });

  it("retains the merged side lane when its branch pointer was deleted", () => {
    let repo = commit(baseRepo(), empty, "base", "alice");
    repo = checkout(createBranch(repo, "feature"), "feature");
    repo = commit(repo, empty, "feature work", "bob");
    const merged: Repo = {
      ...repo,
      currentBranch: "main",
      branches: { main: "c3" },
      commits: { ...repo.commits, c3: {
        id: "c3", message: "merge feature", author: "alice", at: Date.now(),
        timeline: empty, parents: ["c1", "c2"],
      } },
    };
    const graph = buildCommitGraph(merged);
    const lanes = new Map(graph.nodes.map((node) => [node.commit.id, node.lane]));
    expect(lanes.get("c3")).toBe(0);
    expect(lanes.get("c2")).toBe(1);
    expect(graph.edges.filter((edge) => edge.from === "c3")).toHaveLength(2);
  });

  it("uses a stable fallback when there is no main branch", () => {
    const repo = commit(baseRepo(), empty, "work", "alice");
    const renamed = { ...repo, branches: { trunk: "c0", feature: "c1" }, currentBranch: "trunk" };
    expect(buildCommitGraph(renamed)).toEqual(buildCommitGraph({ ...renamed, currentBranch: "feature" }));
  });

  it("keeps every edge pointing at a commit that exists", () => {
    let repo = baseRepo();
    repo = commit(repo, empty, "second", "alice");
    const graph = buildCommitGraph(repo);
    const ids = new Set(Object.keys(repo.commits));
    for (const edge of graph.edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });
});

it("orders concurrent tips newest first without letting clock skew put a parent above its child", () => {
  const root = baseRepo().commits.c0!;
  const commits = {
    c0: { ...root, at: 900 },
    c1: { ...root, id: "c1", parents: ["c0"], at: 100 },
    c2: { ...root, id: "c2", parents: ["c0"], at: 200 },
    c3: { ...root, id: "c3", parents: ["c1", "c2"], at: 50 },
    c4: { ...root, id: "c4", parents: ["c0"], at: 300 },
  };
  expect(orderCommits(commits).map((item) => item.id)).toEqual(["c4", "c3", "c2", "c1", "c0"]);
  expect(orderCommits(Object.fromEntries(Object.entries(commits).reverse()))).toEqual(orderCommits(commits));
});

it("handles empty and pruned histories and rejects cycles rather than hanging", () => {
  expect(orderCommits({})).toEqual([]);
  const root = baseRepo().commits.c0!;
  const repo = { ...baseRepo(), commits: { c0: { ...root, parents: ["missing"] } } };
  expect(buildCommitGraph(repo).nodes).toHaveLength(1);
  expect(buildCommitGraph(repo).edges).toEqual([]);
  expect(() => orderCommits({ c0: { ...root, parents: ["c0"] } })).toThrow("cycle");
});

it("lays out a long history without recursive traversal", () => {
  const root = baseRepo().commits.c0!;
  const commits = Object.fromEntries(Array.from({ length: 12000 }, (_, index) => {
    const id = `c${index}`;
    return [id, { ...root, id, parents: index === 0 ? [] : [`c${index - 1}`] }];
  }));
  expect(orderCommits(commits)).toHaveLength(12000);
});
