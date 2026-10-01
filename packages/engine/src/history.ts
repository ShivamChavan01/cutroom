import { type Timeline } from "./model";
import { type Op, type OpEnvelope, applyOps } from "./ops";

/**
 * History is an append-only op log plus a cursor, not a stack of snapshots.
 *
 * Snapshots of a long timeline are expensive and, worse, invite the
 * temptation to mutate one in place. Replaying from the base is cheap for JSON
 * clip records and gives the property that matters: undo/redo, commit replay,
 * and remote sync all run the identical `applyOp` path, so there is exactly one
 * place where the rules live.
 */
export interface History {
  readonly base: Timeline;
  readonly log: readonly OpEnvelope[];
  /** Number of envelopes currently applied. `log.length` = fully applied. */
  readonly cursor: number;
}

export function createHistory(base: Timeline): History {
  return { base, log: [], cursor: 0 };
}

export function current(history: History): Timeline {
  return applyOps(history.base, history.log.slice(0, history.cursor).map((e) => e.op));
}

function truncateForRedo(history: History): History {
  // Committing after undoing discards the abandoned future, the same way git
  // drops a dangling ref when you commit on a branch that moved.
  return history.cursor === history.log.length
    ? history
    : { ...history, log: history.log.slice(0, history.cursor) };
}

export function record(
  history: History,
  op: Op,
  author: string,
): History {
  const truncated = truncateForRedo(history);
  return {
    ...truncated,
    log: [...truncated.log, { op, author, seq: truncated.log.length }],
    cursor: truncated.log.length + 1,
  };
}

export function canUndo(history: History): boolean {
  return history.cursor > 0;
}

export function canRedo(history: History): boolean {
  return history.cursor < history.log.length;
}

export function undo(history: History): History {
  if (!canUndo(history)) return history;
  return { ...history, cursor: history.cursor - 1 };
}

export function redo(history: History): History {
  if (!canRedo(history)) return history;
  return { ...history, cursor: history.cursor + 1 };
}

/**
 * Authorship per clip, derived from the log rather than stored on the clip.
 *
 * Deriving it means blame is always consistent with what was actually applied:
 * there is no second bookkeeping path that can fall out of date.
 */
export function authorsByClip(history: History): Map<string, string> {
  const authors = new Map<string, string>();
  for (const { op, author } of history.log.slice(0, history.cursor)) {
    switch (op.type) {
      case "addClip":
        authors.set(op.clip.id, author);
        break;
      case "splitClip": {
        // Both halves are attributable to whoever performed the split.
        authors.delete(op.clipId);
        break;
      }
      case "deleteClip":
        authors.delete(op.clipId);
        break;
      default:
        if (authors.has(op.clipId) === false) {
          authors.set(op.clipId, author);
        }
        break;
    }
  }
  // Children of a split inherit the split author; recompute from the log by
  // walking forward and tracking descendants of each split.
  const splitAuthors = new Map<string, string>();
  for (const { op, author } of history.log.slice(0, history.cursor)) {
    if (op.type === "splitClip") splitAuthors.set(op.clipId, author);
  }
  const resolve = (id: string): string | undefined => {
    const direct = authors.get(id);
    if (direct !== undefined) return direct;
    const parentId = id.slice(0, id.lastIndexOf("~"));
    if (parentId.length === 0 || parentId === id) return undefined;
    return splitAuthors.has(parentId) ? splitAuthors.get(parentId) : resolve(parentId);
  };
  const out = new Map<string, string>();
  for (const id of Object.keys(current(history).clips)) {
    const author = resolve(id);
    if (author !== undefined) out.set(id, author);
  }
  return out;
}
