import { describe, expect, it } from "vitest";
import { createHistory, emptyTimeline } from "@cutroom/engine";
import { branchHistory, commit, findMergeBases, type Commit, type Repo } from "./vcs";
import { deserializeProject, serializeProject, toRepo } from "./persistence/project";

function graph(parents: readonly (readonly number[])[]): Repo {
  const timeline = emptyTimeline("graph audit");
  const commits: Record<string, Commit> = {};
  for (const [index, parentIds] of parents.entries()) {
    const id = `c${index}`;
    commits[id] = { id, parents: parentIds.map(parent => `c${parent}`), timeline, message: id, author: "editor", at: 0 };
  }
  return { commits, branches: { main: `c${parents.length - 1}` }, currentBranch: "main", detachedAt: null };
}

describe("Day 1 history invariants", () => {
  it("matches an independent reachability oracle for every five-node DAG and pair of heads", () => {
    // Restrict edges to lower-numbered nodes: all 2^10 possible DAGs with
    // this topological order, including disconnected and criss-cross graphs.
    for (let mask = 0; mask < 1024; mask++) {
      let bit = 0;
      const parents = Array.from({ length: 5 }, (_, child) => Array.from({ length: child }, (_, parent) => {
        const included = (mask & (1 << bit)) !== 0;
        bit++;
        return included ? parent : -1;
      }).filter(parent => parent >= 0));
      const repo = graph(parents);
      const reachable = (head: number): Set<number> => {
        const visited = new Set<number>();
        const visit = (node: number): void => {
          if (visited.has(node)) return;
          visited.add(node);
          for (const parent of parents[node] ?? []) visit(parent);
        };
        visit(head);
        return visited;
      };
      const ancestors = parents.map((_, head) => reachable(head));
      for (let a = 0; a < 5; a++) {
        for (let b = 0; b < 5; b++) {
          const common = [...ancestors[a] ?? []].filter(id => ancestors[b]?.has(id));
          const expected = common.filter(id => !common.some(other => other !== id && ancestors[other]?.has(id)))
            .map(id => `c${id}`).sort();
          expect(findMergeBases(repo, `c${a}`, `c${b}`).map(base => base.id), `graph ${mask}, heads ${a}, ${b}`).toEqual(expected);
        }
      }
    }
  }, 30000);

  it("keeps first-parent branch history separate from merged-in ancestry", () => {
    const repo = graph([[], [0], [0], [1, 2], [3, 2]]);
    expect(branchHistory(repo).map(item => item.id)).toEqual(["c4", "c3", "c1", "c0"]);
    expect(branchHistory(repo, "unknown")).toEqual([]);
    const cyclic = { ...repo, commits: { ...repo.commits, c0: { ...repo.commits.c0!, parents: ["c4"] } } };
    expect(branchHistory(cyclic).map(item => item.id)).toEqual(["c4", "c3", "c1", "c0"]);
  });

  it("allocates a fresh commit ID after restoring a sparse valid commit graph", () => {
    const timeline = emptyTimeline("saved project");
    const initial = graph([[], [0], [0]]);
    const repo: Repo = { ...initial, commits: { c0: initial.commits.c0!, c2: initial.commits.c2! } };
    const restored = toRepo(deserializeProject(serializeProject({ history: createHistory(timeline), repo })).repo);
    const before = JSON.stringify(restored);
    const updated = commit(restored, { ...timeline, id: "new edit" }, "continue editing", "editor");
    expect(Object.keys(updated.commits)).toHaveLength(3);
    expect(updated.commits.c2).toEqual(restored.commits.c2);
    expect(updated.branches.main).not.toBe("c2");
    expect(updated.commits[updated.branches.main!]?.parents).toEqual(["c2"]);
    expect(JSON.stringify(restored)).toBe(before);
    expect(() => deserializeProject(serializeProject({ history: createHistory(timeline), repo: updated }))).not.toThrow();
  });
});
