import {
  type History,
  type Op,
  type OpEnvelope,
  type Timeline,
  applyOps,
} from "@cutroom/engine";
import type { Commit, Repo } from "../vcs";

/**
 * Project persistence: the pure half.
 *
 * Everything here is plain data in, plain data out — no IndexedDB, no
 * browser globals. That is deliberate: the interesting failures (a bad
 * version, a corrupted op log, a merge commit whose parent is missing) are
 * testable without a storage layer, and the storage layer stays a thin
 * wrapper that cannot corrupt data it did not create.
 */
export const PROJECT_SCHEMA_VERSION = 1;

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

export interface PersistedProject {
  readonly version: number;
  readonly history: PersistedHistory;
  readonly repo: PersistedRepo;
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
}): string {
  const project: PersistedProject = {
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

/**
 * Parse and validate stored project data.
 *
 * Validation replays the op log through the engine's own reducer rather
 * than re-implementing the rules: if `applyOps` accepts it, the engine can
 * reproduce it. A commit whose parent is missing is rejected too — it would
 * render the graph wrong and the merge base would be a lie.
 */
export function deserializeProject(raw: string): PersistedProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectLoadError("stored project is not valid JSON", raw);
  }
  if (!isRecord(parsed)) {
    throw new ProjectLoadError("stored project is not an object", raw);
  }
  if (parsed.version !== PROJECT_SCHEMA_VERSION) {
    throw new ProjectLoadError(
      `stored project has version ${String(parsed.version)}, ` +
        `this build reads ${PROJECT_SCHEMA_VERSION}`,
      raw,
    );
  }
  const history = parsed.history;
  if (!isRecord(history) || !isRecord(history.base) || !Array.isArray(history.log)) {
    throw new ProjectLoadError("stored project has no usable history", raw);
  }
  if (typeof history.cursor !== "number" || history.cursor < 0) {
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
  const envelopes = history.log as readonly OpEnvelope[];
  try {
    applyOps(history.base as unknown as Timeline, envelopes.map((e) => e.op));
  } catch (error) {
    throw new ProjectLoadError(
      `stored project has an unusable op log: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      raw,
    );
  }

  // Every commit's parents must exist, or the graph and the merge base lie.
  const commits = repo.commits as Record<string, Commit>;
  for (const commit of Object.values(commits)) {
    for (const parent of commit.parents) {
      if (commits[parent] === undefined) {
        throw new ProjectLoadError(
          `commit ${commit.id} references missing parent ${parent}`,
          raw,
        );
      }
    }
  }
  const branches = repo.branches as Record<string, string>;
  for (const [name, commitId] of Object.entries(branches)) {
    if (commits[commitId] === undefined) {
      throw new ProjectLoadError(
        `branch ${name} points at missing commit ${commitId}`,
        raw,
      );
    }
  }

  return {
    version: PROJECT_SCHEMA_VERSION,
    history: {
      base: history.base as unknown as Timeline,
      log: envelopes,
      cursor: history.cursor,
    },
    repo: {
      commits,
      branches,
      currentBranch: repo.currentBranch,
      detachedAt: (repo.detachedAt as string | null) ?? null,
    },
  };
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

/** Type guard for a persisted op, used by the store when restoring. */
export function isOp(value: unknown): value is Op {
  return isRecord(value) && typeof value.type === "string";
}
