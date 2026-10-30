import {
  conflictKey, isUnchanged, mergeTimelines, resolveField, resolveMetadata, resolveProject,
  type MergeResult, type Timeline,
} from "@cutroom/engine";
import {findMergeBase, head, resolveDeleteModify, resolveOverlap, type Commit, type Repo} from "./vcs";

export type MergeChoice = "ours" | "theirs" | "keep" | "remove" | "a" | "b";
export interface MergeResolution {
  readonly key: string;
  readonly choice: MergeChoice;
}
export interface PendingMerge {
  readonly targetBranch: string;
  readonly sourceBranch: string;
  readonly baseId: string;
  readonly workingTimeline: Timeline;
  readonly oursId: string;
  readonly theirsId: string;
  readonly resolutions: readonly MergeResolution[];
  readonly result: MergeResult;
}

export type MergeEntry = {readonly kind: "up-to-date"}
  | {readonly kind: "fast-forward"; readonly source: Commit}
  | {readonly kind: "pending"; readonly pending: PendingMerge};

/** Classify ancestry only after protecting every uncommitted working edit. */
export function prepareMerge(repo: Repo, workingTimeline: Timeline, sourceBranch: string): MergeEntry {
  if (repo.detachedAt !== null) throw new Error("Check out a branch before merging.");
  const ours = head(repo), theirs = head(repo, sourceBranch);
  if (!isUnchanged(ours.timeline, workingTimeline)) throw new Error("Commit your uncommitted changes before merging. Your edits are still intact.");
  const base = findMergeBase(repo, ours.id, theirs.id);
  if (base === null) throw new Error("vcs: no common ancestor");
  if (base.id === theirs.id) return {kind: "up-to-date"};
  if (base.id === ours.id) return {kind: "fast-forward", source: theirs};
  return {kind: "pending", pending: {targetBranch: repo.currentBranch, sourceBranch, baseId: base.id,
    workingTimeline: ours.timeline, oursId: ours.id, theirsId: theirs.id, resolutions: [],
    result: mergeTimelines(base.timeline, ours.timeline, theirs.timeline)}};
}

/** Restore only genuine divergent sessions; never move a branch during reload. */
export function startMerge(repo: Repo, workingTimeline: Timeline, sourceBranch: string): PendingMerge {
  const entry = prepareMerge(repo, workingTimeline, sourceBranch);
  if (entry.kind !== "pending") throw new Error("These versions do not need a pending merge. Start merge again from Versions.");
  return entry.pending;
}

/** Stable conflict identity plus an explicit choice is the recoverable edit. */
export function resolveMerge(result: MergeResult, {key, choice}: MergeResolution): MergeResult {
  const conflict = result.conflicts.find(item => conflictKey(item) === key);
  if (conflict === undefined) throw new Error("This conflict is no longer available. Review the remaining conflicts.");
  switch (conflict.kind) {
    case "overlap":
      if (choice !== "a" && choice !== "b") break;
      return choice === "a" ? resolveOverlap(result, conflict.a, conflict.b) : resolveOverlap(result, conflict.b, conflict.a);
    case "deleteModify":
      if (choice !== "keep" && choice !== "remove") break;
      return resolveDeleteModify(result, conflict.clipId, choice === "keep");
    case "field":
      if (choice !== "ours" && choice !== "theirs") break;
      return resolveField(result, conflict.clipId, conflict.field, choice);
    case "project":
      if (choice !== "ours" && choice !== "theirs") break;
      return resolveProject(result, conflict.field, choice);
    case "assetField": case "trackField": case "assetPresence": case "trackPresence": case "trackOrder":
      if (choice !== "ours" && choice !== "theirs" && choice !== "keep") break;
      return resolveMetadata(result, conflict, choice);
    default: {const exhaustive: never = conflict; return exhaustive;}
  }
  throw new Error("That choice does not apply to this conflict.");
}

export function recordResolution(pending: PendingMerge, resolution: MergeResolution): PendingMerge {
  return {...pending, result: resolveMerge(pending.result, resolution), resolutions: [...pending.resolutions, resolution]};
}

export function isMergeResolution(value: unknown): value is MergeResolution {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "key" in value && typeof value.key === "string" && value.key.length > 0 &&
    "choice" in value && ["ours", "theirs", "keep", "remove", "a", "b"].some(choice => choice === value.choice);
}

export function assertMergeCurrent(pending: PendingMerge, repo: Repo, timeline: Timeline): void {
  if (repo.detachedAt !== null || repo.currentBranch !== pending.targetBranch ||
      head(repo).id !== pending.oursId || head(repo, pending.sourceBranch).id !== pending.theirsId ||
      !isUnchanged(timeline, pending.workingTimeline)) {
    throw new Error("The working timeline or branch heads changed. Cancel and restart the merge to include your edits.");
  }
}
