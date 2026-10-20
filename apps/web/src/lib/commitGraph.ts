import type { Commit, Repo } from "./vcs";

/**
 * Commit graph layout.
 *
 * Turns the commit DAG into rows and lanes the way `git log --graph` draws
 * it: the line you are on stays in the leftmost lane, side branches fork
 * off to the right, and a merge is where two lanes meet. The point of
 * drawing it is that someone who has never used git can still see "these
 * two lines of work came together here".
 *
 * Lane assignment is branch-based, not draw-order-based: the current
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
  const branchLane: Record<string, number> = {};

  /** First-parent chain of a commit, newest first, stopping at `stopAt`. */
  const chainOf = (startId: string): { chain: string[]; forkPoint: string | undefined } => {
    const chain: string[] = [];
    let current: string | undefined = startId;
    let forkPoint: string | undefined;
    while (current !== undefined && !laneOf.has(current)) {
      chain.push(current);
      const parent: Commit | undefined = commits[current];
      current = parent?.parents[0];
      if (current !== undefined) forkPoint = current;
    }
    return { chain, forkPoint };
  };

  // Lane 0 belongs to the branch you are on: its own line stays leftmost.
  const currentHead = repo.branches[repo.currentBranch];
  /** Chain and fork point per branch, captured while lanes are assigned. */
  const chainByBranch = new Map<string, { chain: string[]; forkPoint: string | undefined }>();
  if (currentHead !== undefined) {
    const { chain, forkPoint } = chainOf(currentHead);
    for (const id of chain) laneOf.set(id, 0);
    branchLane[repo.currentBranch] = 0;
    chainByBranch.set(repo.currentBranch, { chain, forkPoint });
  }

  // Every other branch forks to the right, in a stable order.
  let nextLane = 1;
  const otherBranches = Object.entries(repo.branches)
    .filter(([branch]) => branch !== repo.currentBranch)
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

  // Any commit not covered above (a commit whose branch was deleted, or one
  // that a merge skipped) still needs a lane. It continues the line of its
  // child if it has one, otherwise its parent's line — scattering it into a
  // fresh lane would break a line in two for no reason.
  const childrenOf = new Map<string, string[]>();
  for (const commit of ordered) {
    for (const parent of commit.parents) {
      const list = childrenOf.get(parent) ?? [];
      list.push(commit.id);
      childrenOf.set(parent, list);
    }
  }
  for (const commit of ordered) {
    if (laneOf.has(commit.id)) continue;
    const child = childrenOf.get(commit.id)?.find((id) => laneOf.has(id));
    const parent = commit.parents.find((id) => laneOf.has(id));
    const inherited =
      child !== undefined
        ? laneOf.get(child)
        : parent !== undefined
          ? laneOf.get(parent)
          : undefined;
    const lane = inherited ?? nextLane++;
    laneOf.set(commit.id, lane);
  }

  // Edges. The tail edge of each side branch is tagged so it can be drawn
  // in that branch's colour — that is what makes a fork look like a fork.
  const branchOfEdge = new Map<string, string>();
  for (const [branch, headId] of Object.entries(repo.branches)) {
    if (branch === repo.currentBranch) continue;
    const { chain, forkPoint } = chainByBranch.get(branch) ?? { chain: [], forkPoint: undefined };
    const tail = chain[chain.length - 1];
    if (tail === undefined || forkPoint === undefined) continue;
    branchOfEdge.set(`${tail}->${forkPoint}`, branch);
  }
  const edges: GraphEdge[] = [];
  for (const commit of ordered) {
    for (const parentId of commit.parents) {
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
