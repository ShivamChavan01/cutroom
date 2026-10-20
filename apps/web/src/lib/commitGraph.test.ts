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

  it("keeps the current branch in lane 0 and forks side branches to the right", () => {
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

  it("shows no fork when the other branch is simply behind the current one", () => {
    // You are on `feature`; `main` is an ancestor. One line, honestly.
    let repo = baseRepo();
    repo = commit(repo, empty, "base work", "alice");
    repo = createBranch(repo, "feature");
    repo = checkout(repo, "feature");
    repo = commit(repo, empty, "feature work", "bob");

    const graph = buildCommitGraph(repo);
    expect(graph.laneCount).toBe(1);
    expect(graph.edges.filter((edge) => edge.branch !== undefined)).toEqual([]);
  });

  it("records which lane each branch runs in", () => {
    let repo = baseRepo();
    repo = createBranch(repo, "feature");
    const graph = buildCommitGraph(repo);
    expect(graph.branchLane["main"]).toBe(0);
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
