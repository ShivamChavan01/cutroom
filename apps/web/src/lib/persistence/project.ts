import {assertMergeCurrent, isMergeResolution, recordResolution, startMerge, type PendingMerge} from "../mergeSession";
import {
  type Asset,
  type Clip,
  type Track,
  type History,
  type Op,
  type OpEnvelope,
  type Timeline,
  applyOps,
  current,
  clipIsWellFormed,
  TRANSFORM_FIELDS,
} from "@cutroom/engine";
import { findMergeBases, type Commit, type Repo } from "../vcs";

/**
 * Project persistence: the pure half.
 *
 * Everything here is plain data in, plain data out — no IndexedDB, no
 * browser globals. That is deliberate: the interesting failures (a bad
 * version, a corrupted op log, a merge commit whose parent is missing) are
 * testable without a storage layer, and the storage layer stays a thin
 * wrapper that cannot corrupt data it did not create.
 */
export const PROJECT_SCHEMA_VERSION = 2;

export interface PersistedHistory {
  readonly base: Timeline;
  readonly log: readonly OpEnvelope[];
  readonly cursor: number;
}

export interface PersistedRepo {
  readonly commits: Readonly<Record<string, Commit>>;
  readonly branches: Readonly<Record<string, string>>;
  readonly currentBranch: string;
  readonly detachedAt: string | null;
}

export interface RestoredProject {
  readonly version: number;
  readonly history: PersistedHistory;
  readonly repo: PersistedRepo;
  readonly pending: PendingMerge | null;
  readonly mergeRecovery: string | null;
}

/** A recoverable problem with stored data. Carries the raw text so the
 *  user can export it before it is discarded. */
export class ProjectLoadError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "ProjectLoadError";
    this.raw = raw;
  }
}

export function serializeProject(input: {
  readonly history: History;
  readonly repo: Repo;
  readonly pending?: PendingMerge | null;
}): string {
  const pending = input.pending;
  const project = {
    pending: pending == null ? null : {targetBranch: pending.targetBranch, sourceBranch: pending.sourceBranch,
      baseId: pending.baseId, oursId: pending.oursId, theirsId: pending.theirsId,
      workingTimeline: pending.workingTimeline, resolutions: pending.resolutions},
    version: PROJECT_SCHEMA_VERSION,
    history: {
      base: input.history.base,
      log: input.history.log,
      cursor: input.history.cursor,
    },
    repo: {
      commits: input.repo.commits,
      branches: input.repo.branches,
      currentBranch: input.repo.currentBranch,
      detachedAt: input.repo.detachedAt,
    },
  };
  return JSON.stringify(project);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalNumbers(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every(field => value[field] === undefined || isFiniteNumber(value[field]));
}

function isClip(value: unknown): value is Clip {
  return isRecord(value) && typeof value.id === "string" && typeof value.trackId === "string" &&
    typeof value.assetId === "string" &&
    ["start", "inPoint", "duration", "outPoint", "volume"].every(field => isFiniteNumber(value[field])) &&
    optionalNumbers(value, TRANSFORM_FIELDS);
}

function isTrack(value: unknown): value is Track {
  return isRecord(value) && typeof value.id === "string" &&
    (value.kind === "video" || value.kind === "audio") &&
    typeof value.name === "string" && typeof value.muted === "boolean";
}

function isAsset(value: unknown): value is Asset {
  return isRecord(value) && typeof value.id === "string" &&
    (value.kind === "video" || value.kind === "audio" || value.kind === "image") &&
    isFiniteNumber(value.duration) && value.duration >= 0 &&
    optionalNumbers(value, ["width", "height", "bytes"]) &&
    ["width", "height", "bytes"].every(field => value[field] === undefined || (typeof value[field] === "number" && value[field] >= 0)) &&
    ["proxyId", "name", "mimeType"].every(field => value[field] === undefined || typeof value[field] === "string") &&
    (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every(tag => typeof tag === "string")));
}

function isTimeline(value: unknown): value is Timeline {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.clips) ||
      !isRecord(value.assets) || !Array.isArray(value.tracks)) return false;
  if (value.fps !== undefined && (!isFiniteNumber(value.fps) || value.fps < 1 || value.fps > 120)) return false;
  if (!value.tracks.every(isTrack) || new Set(value.tracks.map(track => track.id)).size !== value.tracks.length) return false;
  // Missing media remains a valid, lintable state. Validate stored shapes and
  // timing here without inventing assets or discarding offline timelines.
  return Object.entries(value.clips).every(([id, clip]) => isClip(clip) && clip.id === id && clipIsWellFormed(clip)) &&
    Object.entries(value.assets).every(([id, asset]) => isAsset(asset) && asset.id === id);
}

function isEnvelope(value: unknown): value is OpEnvelope {
  return isRecord(value) && isOp(value.op) && typeof value.author === "string" &&
    typeof value.seq === "number" && Number.isSafeInteger(value.seq) && value.seq >= 0;
}

function isCommit(value: unknown): value is Commit {
  return isRecord(value) && typeof value.id === "string" && typeof value.message === "string" &&
    typeof value.author === "string" && isFiniteNumber(value.at) && isTimeline(value.timeline) &&
    Array.isArray(value.parents) && value.parents.every(parent => typeof parent === "string");
}

/**
 * Parse and validate stored project data.
 *
 * Validation replays the op log through the engine's own reducer rather
 * than re-implementing the rules: if `applyOps` accepts it, the engine can
 * reproduce it. A commit whose parent is missing is rejected too — it would
 * render the graph wrong and the merge base would be a lie.
 */
export function deserializeProject(raw: string): RestoredProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectLoadError("stored project is not valid JSON", raw);
  }
  if (!isRecord(parsed)) {
    throw new ProjectLoadError("stored project is not an object", raw);
  }
  if (parsed.version !== 1 && parsed.version !== PROJECT_SCHEMA_VERSION) {
    throw new ProjectLoadError(
      `stored project has version ${String(parsed.version)}, ` +
        `this build reads 1 and ${PROJECT_SCHEMA_VERSION}`,
      raw,
    );
  }
  const history = parsed.history;
  if (!isRecord(history) || !isTimeline(history.base) || !Array.isArray(history.log)) {
    throw new ProjectLoadError("stored project has no usable history", raw);
  }
  if (typeof history.cursor !== "number" || !Number.isSafeInteger(history.cursor) || history.cursor < 0 || history.cursor > history.log.length) {
    throw new ProjectLoadError("stored project has an invalid undo cursor", raw);
  }
  const repo = parsed.repo;
  if (
    !isRecord(repo) ||
    !isRecord(repo.commits) ||
    !isRecord(repo.branches) ||
    typeof repo.currentBranch !== "string"
  ) {
    throw new ProjectLoadError("stored project has no usable version history", raw);
  }
  if (repo.detachedAt !== null && typeof repo.detachedAt !== "string") {
    throw new ProjectLoadError("stored project has an invalid HEAD state", raw);
  }

  // Replay: the engine's own rules decide what a valid op log is.
  if (!history.log.every(isEnvelope)) {
    throw new ProjectLoadError("stored project has an unusable op log: malformed operation or envelope", raw);
  }
  const envelopes = history.log;
  try {
    const replayed = applyOps(history.base, envelopes.map((e) => e.op));
    if (!isTimeline(replayed)) throw new Error("operation replay produced a malformed timeline");
  } catch (error) {
    throw new ProjectLoadError(
      `stored project has an unusable op log: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      raw,
    );
  }

  // Every commit's parents must exist, or the graph and the merge base lie.
  const commits: Record<string, Commit> = {};
  for (const [id, commit] of Object.entries(repo.commits)) {
    if (!isCommit(commit) || commit.id !== id) {
      throw new ProjectLoadError(`commit ${id} is malformed`, raw);
    }
    Object.defineProperty(commits, id, { value: commit, enumerable: true, configurable: true, writable: true });
  }
  for (const commit of Object.values(commits)) {
    for (const parent of commit.parents) {
      if (!Object.hasOwn(commits, parent)) {
        throw new ProjectLoadError(
          `commit ${commit.id} references missing parent ${parent}`,
          raw,
        );
      }
    }
  }
  const branches: Record<string, string> = {};
  for (const [name, commitId] of Object.entries(repo.branches)) {
    if (typeof commitId !== "string" || !Object.hasOwn(commits, commitId)) {
      throw new ProjectLoadError(
        `branch ${name} points at missing commit ${commitId}`,
        raw,
      );
    }
    Object.defineProperty(branches, name, { value: commitId, enumerable: true, configurable: true, writable: true });
  }

  if (!Object.hasOwn(branches, repo.currentBranch) || branches[repo.currentBranch] === undefined || (typeof repo.detachedAt === "string" && !Object.hasOwn(commits, repo.detachedAt))) {
    throw new ProjectLoadError("stored project HEAD points at a missing branch or commit", raw);
  }
  // A synthetic head reaches every commit, including abandoned/detached lines,
  // allowing the existing iterative graph validator to reject cycles once.
  let validationId = "__validation_head__";
  while (commits[validationId] !== undefined) validationId += "_";
  const validationHead: Commit = { id: validationId, parents: Object.keys(commits), timeline: history.base, message: "validate", author: "", at: 0 };
  try {
    findMergeBases({ commits: { ...commits, [validationId]: validationHead }, branches, currentBranch: repo.currentBranch, detachedAt: null }, validationId, validationId);
  } catch (error) {
    throw new ProjectLoadError(error instanceof Error ? error.message : "invalid commit graph", raw);
  }

  const restoredRepo: Repo = {commits, branches, currentBranch: repo.currentBranch, detachedAt: repo.detachedAt};
  const activeTimeline = current({base: history.base, log: envelopes, cursor: history.cursor});
  const recovered = recoverMerge(parsed.pending, restoredRepo, activeTimeline);
  return {
    ...recovered,
    version: PROJECT_SCHEMA_VERSION,
    history: {
      base: history.base,
      log: envelopes,
      cursor: history.cursor,
    },
    repo: {
      commits,
      branches,
      currentBranch: repo.currentBranch,
      detachedAt: repo.detachedAt,
    },
  };
}

/** Only input snapshots and recorded choices cross storage; results are replayed. */
function recoverMerge(value: unknown, repo: Repo, timeline: Timeline): Pick<RestoredProject, "pending" | "mergeRecovery"> {
  if (value === undefined || value === null) return {pending: null, mergeRecovery: null};
  try {
    if (!isRecord(value) || typeof value.sourceBranch !== "string" || typeof value.targetBranch !== "string" ||
        typeof value.baseId !== "string" || typeof value.oursId !== "string" || typeof value.theirsId !== "string" ||
        !isTimeline(value.workingTimeline) || !Array.isArray(value.resolutions) || value.resolutions.length > 10000 ||
        !value.resolutions.every(isMergeResolution)) throw new Error("The saved merge data is malformed.");
    let pending = startMerge(repo, value.workingTimeline, value.sourceBranch);
    if (pending.targetBranch !== value.targetBranch || pending.baseId !== value.baseId ||
        pending.oursId !== value.oursId || pending.theirsId !== value.theirsId) throw new Error("The saved merge references different versions.");
    assertMergeCurrent(pending, repo, timeline);
    for (const resolution of value.resolutions) pending = recordResolution(pending, resolution);
    return {pending, mergeRecovery: null};
  } catch (error) {
    return {pending: null, mergeRecovery: `Unfinished merge could not be restored: ${error instanceof Error ? error.message : "invalid merge"} Saved versions and working edits were recovered. Start a new merge from Versions.`};
  }
}

/** Rebuild an engine History from persisted state. */
export function toHistory(persisted: PersistedHistory): History {
  return {
    base: persisted.base,
    log: persisted.log,
    cursor: persisted.cursor,
  };
}

export function toRepo(persisted: PersistedRepo): Repo {
  return {
    commits: persisted.commits,
    branches: persisted.branches,
    currentBranch: persisted.currentBranch,
    detachedAt: persisted.detachedAt,
  };
}

/** Validate the entire persisted operation variant before calling the reducer. */
export function isOp(value: unknown): value is Op {
  if (!isRecord(value)) return false;
  const clipId = typeof value.clipId === "string";
  switch (value.type) {
    case "addClip": return isClip(value.clip) && clipIsWellFormed(value.clip);
    case "addTrack": return isTrack(value.track);
    case "detachAudio": return clipId && typeof value.trackId === "string";
    case "deleteClip": return clipId;
    case "splitClip": return clipId && isFiniteNumber(value.at);
    case "trimClip": return clipId && optionalNumbers(value, ["inPoint", "duration"]);
    case "moveClip": return clipId && isFiniteNumber(value.start) && (value.trackId === undefined || typeof value.trackId === "string");
    case "setVolume": return clipId && isFiniteNumber(value.volume);
    case "setTransform": return clipId && optionalNumbers(value, TRANSFORM_FIELDS);
    case "setFrameRate": return isFiniteNumber(value.fps);
    case "renameProject": return typeof value.name === "string";
    case "setAssetTags": return typeof value.assetId === "string" && Array.isArray(value.tags) && value.tags.every(tag => typeof tag === "string");
    default: return false;
  }
}
