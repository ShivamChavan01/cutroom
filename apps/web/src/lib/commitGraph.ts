import type { Commit, Repo } from "./vcs";

/**
 * Commit graph layout.
 *
 * Turns the commit DAG into rows and lanes the way `git log --graph` draws
 * it: each commit is a node, each line of work is a lane, and a merge is
 * the point where two lanes meet. The point of drawing it is that someone
 * who does not know what a branch is can still see "these two lines of work
 * came together here".
 *
 * Pure: takes a repo, returns geometry. No React, no DOM — the layout is
 * testable, and the component only draws what it is handed.
 */

export interface GraphNode {
  readonly commit: Commit;
  readonly lane: number;
  readonly row: number;
}

export interface GraphEdge {
  /** Child commit id. */
  readonly from: string;
  /** Parent commit id. */
  readonly to: string;
}

export interface BranchTip {
  readonly branch: string;
  readonly commitId: string;
}

export interface CommitGraph {
  /** Newest first — the order rows are drawn in. */
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly laneCount: number;
  readonly branchTips: readonly BranchTip[];
}

/** Commits ordered newest-first, parents always after their children. */
export function orderCommits(commits: Readonly<Record<string, Commit>>): Commit[] {
  const children = new Map<string, string[]>();
  for (const commit of Object.values(commits)) {
    for (const parent of commit.parents) {
      const list = children.get(parent) ?? [];
      list.push(commit.id);
      children.set(parent, list);
    }
  }
  const roots = Object.values(commits)
    .filter((commit) => commit.parents.length === 0)
    .map((commit) => commit.id);

  const ordered: Commit[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    // Children first, so the newest commit ends up at the top.
    for (const child of children.get(id) ?? []) visit(child);
    const commit = commits[id];
    if (commit !== undefined) ordered.push(commit);
  };
  for (const root of roots) visit(root);
  // Commits whose parents are missing (pruned history) still need a row.
  for (const id of Object.keys(commits)) visit(id);
  return ordered;
}

export function buildCommitGraph(repo: Repo): CommitGraph {
  const commits = repo.commits;
  const ordered = orderCommits(commits);

  const laneOf = new Map<string, number>();
  /**
   * Lane slot -> the commit that slot's line is running down to, or null
   * when the line has ended (a merge point) and the slot can be reused.
   */
  const lanes: (string | null)[] = [];
  /** A commit whose lane is already decided (a merge's second parent). */
  const reserved = new Map<string, number>();
  const edges: GraphEdge[] = [];
  let maxLane = 0;

  const allocateLane = (): number => {
    const index = lanes.findIndex((slot) => slot === null);
    if (index === -1) {
      lanes.push(null);
      return lanes.length - 1;
    }
    return index;
  };

  ordered.forEach((commit) => {
    // A line runs down to a commit: the commit that a slot is waiting for
    // keeps that slot, everything else starts or continues a line.
    const lane = reserved.get(commit.id) ?? allocateLane();
    if (lane + 1 > maxLane) maxLane = lane + 1;
    laneOf.set(commit.id, lane);
    reserved.delete(commit.id);
    // This slot's line continues past the commit we just drew.
    lanes[lane] = null;

    commit.parents.forEach((parentId, index) => {
      edges.push({ from: commit.id, to: parentId });
      if (laneOf.has(parentId) || reserved.has(parentId)) return;
      if (index === 0) {
        // The first parent's line continues in this lane.
        reserved.set(parentId, lane);
        lanes[lane] = parentId;
      } else {
        // A merge's other parent needs its own lane to run down.
        const other = allocateLane();
        if (other + 1 > maxLane) maxLane = other + 1;
        reserved.set(parentId, other);
        lanes[other] = parentId;
      }
    });
  });

  const nodes: GraphNode[] = ordered.map((commit, row) => ({
    commit,
    lane: laneOf.get(commit.id) ?? 0,
    row,
  }));

  const branchTips: BranchTip[] = Object.entries(repo.branches)
    .map(([branch, commitId]) => ({ branch, commitId }))
    .filter((tip) => commits[tip.commitId] !== undefined);

  return {
    nodes,
    edges,
    laneCount: Math.max(1, maxLane),
    branchTips,
  };
}
