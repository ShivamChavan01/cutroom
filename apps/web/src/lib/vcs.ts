import {
  type Conflict,
  type MergeResult,
  type Timeline,
} from "@cutroom/engine";

/**
 * Git-shaped version control over engine timelines. Pure functions —
 * the store wrapper owns persistence, this module owns the graph.
 *
 * Model, deliberately small: commits snapshot whole timelines (they're
 * small JSON), branches are named pointers at heads, merges record two
 * parents. No staging area, no remotes, no partial checkout — the working
 * timeline in the editor store is always the checkout, and committing
 * snapshots it whole.
 */
export interface Commit {
  readonly id: string;
  readonly message: string;
  readonly author: string;
  readonly at: number;
  readonly timeline: Timeline;
  readonly parents: readonly string[];
}

export interface Repo {
  readonly commits: Readonly<Record<string, Commit>>;
  readonly branches: Readonly<Record<string, string>>;
  readonly currentBranch: string;
}

export function createRepo(initial: Timeline, author: string): Repo {
  const root: Commit = {
    id: "c0",
    message: "initial commit",
    author,
    at: Date.now(),
    timeline: initial,
    parents: [],
  };
  return {
    commits: { c0: root },
    branches: { main: "c0" },
    currentBranch: "main",
  };
}

export function head(repo: Repo, branch?: string): Commit {
  const commit = repo.commits[repo.branches[branch ?? repo.currentBranch] ?? ""];
  if (commit === undefined) throw new Error("vcs: branch has no head");
  return commit;
}

function nextId(repo: Repo): string {
  return `c${Object.keys(repo.commits).length}`;
}

function withCommit(repo: Repo, commit: Commit, moveBranch?: string): Repo {
  const branches = { ...repo.branches };
  if (moveBranch !== undefined) branches[moveBranch] = commit.id;
  return {
    ...repo,
    commits: { ...repo.commits, [commit.id]: commit },
    branches,
  };
}

export function commit(
  repo: Repo,
  timeline: Timeline,
  message: string,
  author: string,
  parents?: readonly string[],
): Repo {
  const commit: Commit = {
    id: nextId(repo),
    message,
    author,
    at: Date.now(),
    timeline,
    parents: parents ?? [head(repo).id],
  };
  return withCommit(repo, commit, repo.currentBranch);
}

export function createBranch(repo: Repo, name: string): Repo {
  if (name.trim().length === 0) throw new Error("vcs: empty branch name");
  if (repo.branches[name] !== undefined) {
    throw new Error(`vcs: branch ${name} already exists`);
  }
  return { ...repo, branches: { ...repo.branches, [name]: head(repo).id } };
}

export function checkout(repo: Repo, name: string): Repo {
  if (repo.branches[name] === undefined) {
    throw new Error(`vcs: no branch ${name}`);
  }
  return { ...repo, currentBranch: name };
}

/** All ancestors of a commit, inclusive, newest-first by BFS depth. */
export function ancestors(repo: Repo, id: string): string[] {
  const seen = new Set<string>();
  const queue = [id];
  const out: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    out.push(current);
    const commit = repo.commits[current];
    if (commit !== undefined) queue.push(...commit.parents);
  }
  return out;
}

/** Nearest common ancestor of two heads, or null on unrelated histories. */
export function findMergeBase(repo: Repo, a: string, b: string): Commit | null {
  const ancestorsOfA = new Set(ancestors(repo, a));
  for (const id of ancestors(repo, b)) {
    if (ancestorsOfA.has(id)) return repo.commits[id] ?? null;
  }
  return null;
}

/** First-parent chain for display: the branch's own story, not merged-in side lines. */
export function branchHistory(repo: Repo, branch?: string): Commit[] {
  const out: Commit[] = [];
  let id: string | undefined = repo.branches[branch ?? repo.currentBranch];
  const seen = new Set<string>();
  while (id !== undefined && !seen.has(id)) {
    seen.add(id);
    const commit = repo.commits[id];
    if (commit === undefined) break;
    out.push(commit);
    id = commit.parents[0];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conflict resolution over an in-progress MergeResult. Each resolver drops
// the conflicts it settles; resolving never invents timeline content, it
// only picks sides or removes clips.
// ---------------------------------------------------------------------------

/** Keep the survivor (default, nothing to do) or remove it. */
export function resolveDeleteModify(
  result: MergeResult,
  clipId: string,
  keep: boolean,
): MergeResult {
  const clips = { ...result.merged.clips };
  if (!keep) delete clips[clipId];
  const conflicts: Conflict[] = result.conflicts.filter(
    (c) =>
      !(
        (c.kind === "deleteModify" && c.clipId === clipId) ||
        (!keep && c.kind === "field" && c.clipId === clipId)
      ),
  );
  return {
    ...result,
    merged: { ...result.merged, clips },
    conflicts,
    clean: conflicts.length === 0,
  };
}

/**
 * Settle an overlap by removing one side. Conflicts touching the removed
 * clip go with it — a deleted clip has no fields left to argue about.
 */
export function resolveOverlap(
  result: MergeResult,
  keepId: string,
  dropId: string,
): MergeResult {
  const clips = { ...result.merged.clips };
  delete clips[dropId];
  const conflicts: Conflict[] = result.conflicts.filter((c) => {
    if (c.kind === "overlap") {
      return !(
        (c.a === keepId && c.b === dropId) ||
        (c.a === dropId && c.b === keepId)
      );
    }
    if (c.kind === "field" || c.kind === "deleteModify") {
      return c.clipId !== dropId;
    }
    return true;
  });
  return {
    ...result,
    merged: { ...result.merged, clips },
    conflicts,
    clean: conflicts.length === 0,
  };
}
