import {
  type Asset,
  type Clip,
  type Millis,
  type Timeline,
  clipIsWellFormed,
  outPointOf,
} from "./model";

/**
 * Ops are the *only* way timeline state changes. There is exactly one reducer,
 * `applyOp`, and it is called from exactly three places: local edits, remote
 * sync replay, and commit replay. Because authorship and history are derived
 * from the op log rather than maintained separately, a replayed commit cannot
 * drift from what was originally recorded.
 */

export type Op =
  | { readonly type: "addClip"; readonly clip: Clip }
  | { readonly type: "deleteClip"; readonly clipId: string }
  | { readonly type: "splitClip"; readonly clipId: string; readonly at: Millis }
  | {
      readonly type: "trimClip";
      readonly clipId: string;
      readonly inPoint?: Millis;
      readonly duration?: Millis;
    }
  | {
      readonly type: "moveClip";
      readonly clipId: string;
      readonly start: Millis;
      readonly trackId?: string;
    }
  | { readonly type: "setVolume"; readonly clipId: string; readonly volume: number };

export interface OpEnvelope {
  readonly op: Op;
  readonly author: string;
  /** Monotonic per-branch clock, not a wall time. Two branches may reuse it. */
  readonly seq: number;
}

/**
 * Deterministic, synchronous string hash. Deliberately not `crypto.subtle`:
 * that is async, and split IDs must be computable inside the reducer during a
 * synchronous replay. Collisions across a handful of splits are not a real
 * concern, and the tests assert the property that actually matters —
 * same (parent, point) yields the same child ID on both branches.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Split child IDs are a pure function of (parent id, split point, side).
 *
 * This is the load-bearing trick in the whole merge design: if two branches
 * independently split the same clip at the same frame, they derive the *same*
 * child IDs, so the 3-way merge recognises identical edits as identical
 * instead of manufacturing a conflict out of two equivalent results.
 *
 * The point is normalized to integer milliseconds first, so `1000.0` and
 * `1000.0004` do not fork into two different pairs of children.
 */
export function splitChildId(
  parentId: string,
  at: Millis,
  side: "L" | "R",
): string {
  const ms = Math.round(at);
  return `${parentId}~${ms}~${side}~${fnv1a(`${parentId}:${ms}:${side}`)}`;
}

function mustClip(timeline: Timeline, clipId: string): Clip {
  const clip = timeline.clips[clipId];
  if (clip === undefined) {
    throw new Error(`applyOp: unknown clip ${clipId}`);
  }
  return clip;
}

function withClips(
  timeline: Timeline,
  clips: Record<string, Clip>,
): Timeline {
  return { ...timeline, clips };
}

function writeClip(
  timeline: Timeline,
  clip: Clip,
): Timeline {
  if (!clipIsWellFormed(clip)) {
    throw new Error(
      `applyOp: refusing to write malformed clip ${clip.id} ` +
        `(inPoint=${clip.inPoint} duration=${clip.duration})`,
    );
  }
  return withClips(timeline, { ...timeline.clips, [clip.id]: clip });
}

/**
 * The single reducer. Pure: returns a new timeline, never mutates the input.
 * Throws on an op that cannot apply to the given state rather than silently
 * no-oping, because a silently dropped op is indistinguishable from a lost
 * one once it is three commits deep.
 */
export function applyOp(timeline: Timeline, op: Op): Timeline {
  switch (op.type) {
    case "addClip": {
      if (timeline.clips[op.clip.id] !== undefined) {
        throw new Error(`applyOp: clip ${op.clip.id} already exists`);
      }
      return writeClip(timeline, op.clip);
    }

    case "deleteClip": {
      const clip = timeline.clips[op.clipId];
      const next = { ...timeline.clips };
      if (clip === undefined) {
        // The parent may already be gone because it was split: its children
        // carry the `parentId~` prefix, so a delete addressed to the parent
        // still reaches them. A delete addressed to an id that never existed
        // stays loud, below.
        const prefix = `${op.clipId}~`;
        const descendants = Object.keys(next).filter((id) => id.startsWith(prefix));
        if (descendants.length === 0) {
          throw new Error(`applyOp: unknown clip ${op.clipId}`);
        }
        for (const id of descendants) delete next[id];
        return withClips(timeline, next);
      }
      // Deleting a parent also removes any child produced by splitting it.
      for (const id of Object.keys(next)) {
        if (id === clip.id || id.startsWith(`${clip.id}~`)) {
          delete next[id];
        }
      }
      return withClips(timeline, next);
    }

    case "splitClip": {
      const at = Math.round(op.at);
      const leftId = splitChildId(op.clipId, at, "L");
      const rightId = splitChildId(op.clipId, at, "R");
      if (timeline.clips[leftId] !== undefined && timeline.clips[rightId] !== undefined) {
        // This exact split already happened (a replayed op stream can
        // legitimately contain it). No-op, whatever remains of the parent.
        return timeline;
      }
      const clip = mustClip(timeline, op.clipId);
      // A split at either extreme produces a zero-length clip, which is not a
      // clip. Reject instead of creating an invisible one.
      if (at <= 0 || at >= clip.duration) {
        throw new Error(
          `applyOp: split point ${at} outside clip ${clip.id} of duration ${clip.duration}`,
        );
      }
      const left: Clip = {
        ...clip,
        id: leftId,
        start: clip.start,
        inPoint: clip.inPoint,
        duration: at,
        outPoint: outPointOf({ inPoint: clip.inPoint, duration: at }),
      };
      const right: Clip = {
        ...clip,
        id: rightId,
        start: clip.start + at,
        inPoint: clip.inPoint + at,
        duration: clip.duration - at,
        outPoint: outPointOf({
          inPoint: clip.inPoint + at,
          duration: clip.duration - at,
        }),
      };
      const clips = { ...timeline.clips };
      delete clips[clip.id];
      clips[leftId] = left;
      clips[rightId] = right;
      return withClips(timeline, clips);
    }

    case "trimClip": {
      const clip = mustClip(timeline, op.clipId);
      const inPoint = op.inPoint ?? clip.inPoint;
      const duration = op.duration ?? clip.duration;
      if (duration <= 0) {
        throw new Error(`applyOp: trim would make clip ${clip.id} zero-length`);
      }
      const asset = timeline.assets[clip.assetId];
      if (asset !== undefined && inPoint + duration > asset.duration) {
        throw new Error(
          `applyOp: trim exceeds asset ${clip.assetId} duration ${asset.duration}`,
        );
      }
      return writeClip(timeline, {
        ...clip,
        inPoint,
        duration,
        outPoint: inPoint + duration,
      });
    }

    case "moveClip": {
      const clip = mustClip(timeline, op.clipId);
      if (op.start < 0) {
        throw new Error(`applyOp: negative start ${op.start}`);
      }
      const trackId = op.trackId ?? clip.trackId;
      if (!timeline.tracks.some((track) => track.id === trackId)) {
        throw new Error(`applyOp: unknown track ${trackId}`);
      }
      return writeClip(timeline, { ...clip, start: op.start, trackId });
    }

    case "setVolume": {
      const clip = mustClip(timeline, op.clipId);
      if (op.volume < 0 || op.volume > 1) {
        throw new Error(`applyOp: volume ${op.volume} outside [0, 1]`);
      }
      return writeClip(timeline, { ...clip, volume: op.volume });
    }
  }
}

export function applyOps(timeline: Timeline, ops: readonly Op[]): Timeline {
  return ops.reduce(applyOp, timeline);
}

/** Convenience constructor so callers do not hand-roll `outPoint`. */
export function makeClip(
  init: Omit<Clip, "outPoint">,
): Clip {
  return { ...init, outPoint: init.inPoint + init.duration };
}

export function putAsset(timeline: Timeline, asset: Asset): Timeline {
  return { ...timeline, assets: { ...timeline.assets, [asset.id]: asset } };
}
