import {authorsByClip, sameClip, type Clip, type History, type Timeline} from "@cutroom/engine";
import {currentCommit, type Commit, type Repo} from "./vcs";

// Repository objects are immutable and old ones can be collected. Working edits reuse this result.
const committedCache = new WeakMap<Repo, ReadonlyMap<string, string>>();

/** Follow an identical parent snapshot; a newly combined clip belongs to the merge author. */
function committedAuthor(repo: Repo, start: Commit, clipId: string): string | undefined {
  let commit: Commit | undefined = start;
  const visited = new Set<string>();
  while (commit !== undefined && !visited.has(commit.id)) {
    visited.add(commit.id);
    const clip: Clip | undefined = commit.timeline.clips[clipId];
    if (clip === undefined) return undefined;
    const parent: Commit | undefined = commit.parents.map(id => repo.commits[id])
      .find(candidate => candidate !== undefined && sameClip(clip, candidate.timeline.clips[clipId]));
    if (parent === undefined) return commit.author.trim() === "" ? undefined : commit.author;
    commit = parent;
  }
  return undefined;
}

function headAuthors(repo: Repo, head: Commit): ReadonlyMap<string, string> {
  const cached = committedCache.get(repo);
  if (cached !== undefined) return cached;
  const result = new Map<string, string>();
  for (const id of Object.keys(head.timeline.clips)) {
    const author = committedAuthor(repo, head, id);
    if (author !== undefined) result.set(id, author);
  }
  committedCache.set(repo, result);
  return result;
}

/** History bases precede ordinary commits along the first-parent chain. */
function baseAuthor(repo: Repo, start: Commit, clip: Clip): string | undefined {
  let commit: Commit | undefined = start;
  const visited = new Set<string>();
  while (commit !== undefined && !visited.has(commit.id)) {
    visited.add(commit.id);
    if (sameClip(clip, commit.timeline.clips[clip.id])) return committedAuthor(repo, commit, clip.id);
    const parent: string | undefined = commit.parents[0];
    commit = parent === undefined ? undefined : repo.commits[parent];
  }
  return undefined;
}

/** Snapshot provenance for committed clips; active operation authors for working differences. */
export function clipAuthors(repo: Repo | null, history: History, timeline: Timeline): ReadonlyMap<string, string> {
  const working = authorsByClip(history, timeline);
  if (repo === null) return working;
  const head = currentCommit(repo), committed = headAuthors(repo, head), result = new Map<string, string>();
  for (const clip of Object.values(timeline.clips)) {
    let author: string | undefined;
    if (sameClip(clip, head.timeline.clips[clip.id])) author = committed.get(clip.id);
    else {
      author = working.get(clip.id);
      if (author === undefined && sameClip(clip, history.base.clips[clip.id])) author = baseAuthor(repo, head, clip);
    }
    if (author !== undefined) result.set(clip.id, author);
  }
  return result;
}
