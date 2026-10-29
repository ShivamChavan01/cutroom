import type { Commit, Repo } from "./vcs";

/**
 * Commit graph layout.
 *
 * Turns the commit DAG into rows and lanes the way `git log --graph` draws
 * it: main stays in the leftmost lane, side branches fork
 * off to the right, and a merge is where two lanes meet. The point of
 * drawing it is that someone who has never used git can still see "these
 * two lines of work came together here".
 *
 * Lane assignment is branch-based, not draw-order-based: the main
 * branch's first-parent chain owns lane 0, and every other branch gets the
 * next lane to the right. Assigning lanes in draw order instead puts a
 * freshly-created branch in the leftmost lane and pushes the main line
 * sideways, so a fork never looks like a fork.
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
  /** Branch this edge belongs to, when it is the tail of a branch line. */
  readonly branch?: string;
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
  /** Branch -> the lane its line runs in. */
  readonly branchLane: Readonly<Record<string, number>>;
}

/** Commits ordered newest-first, parents always after their children. */
export function orderCommits(commits: Readonly<Record<string, Commit>>): Commit[] {
  const remainingChildren = new Map<string, number>();
  for (const commit of Object.values(commits)) {
    remainingChildren.set(commit.id, 0);
  }
  for (const commit of Object.values(commits)) {
    for (const parent of new Set(commit.parents)) {
      if (commits[parent] === undefined) continue;
      remainingChildren.set(parent, (remainingChildren.get(parent) ?? 0) + 1);
    }
  }
  const ready = Object.values(commits).filter((commit) => remainingChildren.get(commit.id) === 0);
  const ordered: Commit[] = [];
  while (ready.length > 0) {
    // Timestamp only breaks ties between available tips; ancestry always wins.
    ready.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id, undefined, { numeric: true }));
    const next = ready.shift();
    if (next === undefined) break;
    ordered.push(next);
    for (const parent of new Set(next.parents)) {
      if (commits[parent] === undefined) continue;
      const count = (remainingChildren.get(parent) ?? 0) - 1;
      remainingChildren.set(parent, count);
      const commit = commits[parent];
      if (count === 0 && commit !== undefined) ready.push(commit);
    }
  }
  if (ordered.length !== Object.keys(commits).length) {
    throw new Error("Commit history contains a cycle.");
  }
  return ordered;
}

export function buildCommitGraph(repo: Repo): CommitGraph {
  const commits = repo.commits;
  const ordered = orderCommits(commits);
  const laneOf = new Map<string, number>();
  const branchLane: Record<string, number> = {};

  /** First-parent chain of a commit, newest first, stopping at `stopAt`. */
  const chainOf = (startId: string): { chain: string[]; forkPoint: string | undefined } => {
    const chain: string[] = [];
    let current: string | undefined = startId;
    let forkPoint: string | undefined;
    while (current !== undefined && commits[current] !== undefined && !laneOf.has(current)) {
      chain.push(current);
      const parent: Commit | undefined = commits[current];
      current = parent?.parents[0];
      if (current !== undefined) forkPoint = current;
    }
    return { chain, forkPoint };
  };

  // A checkout changes HEAD, not the geometry of the history.
  const primaryBranch = repo.branches.main !== undefined ? "main" : Object.keys(repo.branches).sort()[0] ?? repo.currentBranch;
  const currentHead = repo.branches[primaryBranch];
  /** Chain and fork point per branch, captured while lanes are assigned. */
  const chainByBranch = new Map<string, { chain: string[]; forkPoint: string | undefined }>();
  if (currentHead !== undefined) {
    const { chain, forkPoint } = chainOf(currentHead);
    for (const id of chain) laneOf.set(id, 0);
    branchLane[primaryBranch] = 0;
    chainByBranch.set(primaryBranch, { chain, forkPoint });
  }

  // Every other branch forks to the right, in a stable order.
  let nextLane = 1;
  const otherBranches = Object.entries(repo.branches)
    .filter(([branch]) => branch !== primaryBranch)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [branch, headId] of otherBranches) {
    const { chain, forkPoint } = chainOf(headId);
    if (chain.length === 0) {
      // The branch points at a commit that is already on another line — it
      // has no commits of its own yet, so it gets no lane.
      continue;
    }
    const lane = nextLane++;
    branchLane[branch] = lane;
    for (const id of chain) laneOf.set(id, lane);
    chainByBranch.set(branch, { chain, forkPoint });
  }

  // Retain merged history even when its branch pointer has been deleted.
  // A merge's second-parent chain must not collapse into its first-parent lane.
  for (const commit of ordered) {
    if (laneOf.has(commit.id)) continue;
    const { chain } = chainOf(commit.id);
    const lane = nextLane++;
    for (const id of chain) laneOf.set(id, lane);
  }

  // Edges. The tail edge of each side branch is tagged so it can be drawn
  // in that branch's colour — that is what makes a fork look like a fork.
  const branchOfEdge = new Map<string, string>();
  for (const branch of Object.keys(repo.branches)) {
    if (branch === primaryBranch) continue;
    const { chain, forkPoint } = chainByBranch.get(branch) ?? { chain: [], forkPoint: undefined };
    const tail = chain[chain.length - 1];
    if (tail === undefined || forkPoint === undefined) continue;
    branchOfEdge.set(`${tail}->${forkPoint}`, branch);
  }
  const edges: GraphEdge[] = [];
  for (const commit of ordered) {
    for (const parentId of commit.parents) {
      if (commits[parentId] === undefined) continue;
      const branch = branchOfEdge.get(`${commit.id}->${parentId}`);
      edges.push(
        branch === undefined
          ? { from: commit.id, to: parentId }
          : { from: commit.id, to: parentId, branch },
      );
    }
  }

  const nodes: GraphNode[] = ordered.map((commit, row) => ({
    commit,
    lane: laneOf.get(commit.id) ?? 0,
    row,
  }));

  const branchTips: BranchTip[] = Object.entries(repo.branches)
    .map(([branch, commitId]) => ({ branch, commitId }))
    .filter((tip) => commits[tip.commitId] !== undefined);

  const maxLane = nodes.reduce((max, node) => Math.max(max, node.lane), 0);

  return {
    nodes,
    edges,
    laneCount: Math.max(1, maxLane + 1),
    branchTips,
    branchLane,
  };
}
