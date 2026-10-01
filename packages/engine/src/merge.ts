import {
  type Clip,
  type Millis,
  type Timeline,
  clipsOnTrack,
  overlaps,
} from "./model";

/**
 * Three-way merge, in two passes.
 *
 * Pass 1 merges each clip per-field against the merge base. Pass 2 sweeps the
 * *merged result* for geometric overlap.
 *
 * The second pass is not redundant with the first, and this is the single most
 * important thing to understand about the design: two edits that are each
 * individually valid can still collide. Branch A trims clip 1 to end at 10s;
 * branch B moves clip 2 to start at 9s. No clip changed on both branches, so
 * a per-clip merge sees zero conflicts and returns a timeline where clips 1
 * and 2 overlap on the same track. Only a geometric pass over the merged
 * result catches it. The tests include exactly this case.
 *
 * Policy, deliberately: overlaps are *surfaced*, never auto-resolved by
 * shifting or trimming. Silently retiming someone's edit is the one thing a
 * video editor will not forgive, because the pixels no longer match what they
 * set. The merge returns a conflict the user resolves on the timeline.
 */

/** Fields that participate in field-level merge. Derived ones are excluded. */
const MERGE_FIELDS = [
  "trackId",
  "assetId",
  "start",
  "inPoint",
  "duration",
  "volume",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

export type FieldConflict = {
  readonly clipId: string;
  readonly field: MergeField;
  readonly base: string | number | undefined;
  readonly ours: string | number | undefined;
  readonly theirs: string | number | undefined;
  readonly kind: "field";
};

export type OverlapConflict = {
  readonly kind: "overlap";
  readonly trackId: string;
  readonly a: string;
  readonly b: string;
  readonly overlapStart: Millis;
  readonly overlapEnd: Millis;
};

export type DeleteModifyConflict = {
  readonly kind: "deleteModify";
  readonly clipId: string;
  readonly oursDeleted: boolean;
  readonly theirsDeleted: boolean;
  readonly survivor: Clip;
};

export type Conflict = FieldConflict | OverlapConflict | DeleteModifyConflict;

export interface MergeResult {
  readonly merged: Timeline;
  readonly conflicts: readonly Conflict[];
  /** Clips taken verbatim from `theirs` because only that side touched them. */
  readonly takenFromTheirs: readonly string[];
  /** Clips dropped because only that side deleted them. */
  readonly deleted: readonly string[];
  readonly clean: boolean;
}

export interface MergeOptions {
  /**
   * Cap on reported overlap conflicts. A cascading overlap can produce hundreds
   * of pairs; the UI shows a capped list and the full picture is on the
   * timeline itself.
   */
  readonly maxOverlapConflicts?: number;
}

function clipFieldsEqual(a: Clip, b: Clip, field: MergeField): boolean {
  return a[field] === b[field];
}

function clipsEqual(a: Clip, b: Clip): boolean {
  return MERGE_FIELDS.every((field) => clipFieldsEqual(a, b, field));
}

function withConsistentOutPoint(clip: Clip): Clip {
  return { ...clip, outPoint: clip.inPoint + clip.duration };
}

/**
 * Merge fields of `ours` and `theirs` against `base`, where `base` may be
 * undefined (a concurrent add on both sides). Returns the merged clip and
 * records a conflict per field both sides changed differently. The merged
 * clip keeps *ours* for conflicted fields so the result stays renderable.
 */
function mergeFields(
  id: string,
  base: Clip | undefined,
  ours: Clip,
  theirs: Clip,
  conflicts: Conflict[],
): Clip {
  let result: Clip = ours;
  for (const field of MERGE_FIELDS) {
    if (clipFieldsEqual(ours, theirs, field)) continue;
    if (base !== undefined && clipFieldsEqual(base, ours, field)) {
      result = { ...result, [field]: theirs[field] } as Clip;
      continue;
    }
    if (base !== undefined && clipFieldsEqual(base, theirs, field)) {
      continue;
    }
    conflicts.push({
      kind: "field",
      clipId: id,
      field,
      base: base?.[field],
      ours: ours[field],
      theirs: theirs[field],
    });
  }
  return withConsistentOutPoint(result);
}

/**
 * Pass 1. Per-clip, per-field.
 *
 * Only ours-changed -> take ours. Only theirs-changed -> take theirs. Both
 * changed to the same value -> already converged, take it. Both changed
 * differently -> conflict, and the merged clip keeps *ours* so the result is
 * renderable while the user decides. The engine never invents a value nobody
 * chose.
 */
function mergePass(
  base: Timeline,
  ours: Timeline,
  theirs: Timeline,
  conflicts: Conflict[],
  takenFromTheirs: string[],
  deleted: string[],
): Record<string, Clip> {
  const merged: Record<string, Clip> = {};

  const baseIds = Object.keys(base.clips);
  const ourIds = new Set(Object.keys(ours.clips));
  const theirIds = new Set(Object.keys(theirs.clips));

  // Union of all three id spaces, so an id present in any two survives.
  const allIds = new Set<string>([...baseIds, ...ourIds, ...theirIds]);

  for (const id of allIds) {
    const inBase = base.clips[id];
    const inOurs = ours.clips[id];
    const inTheirs = theirs.clips[id];

    // Absent on both sides: both deleted. Convergent, nothing to keep.
    // (This is the common shape after a same-point split on both branches:
    // the parent is gone everywhere and the identical children merge below.)
    if (inBase !== undefined && inOurs === undefined && inTheirs === undefined) {
      deleted.push(id);
      continue;
    }

    // Added on one side only.
    if (inBase === undefined && inOurs !== undefined && inTheirs === undefined) {
      merged[id] = inOurs;
      continue;
    }
    if (inBase === undefined && inOurs === undefined && inTheirs !== undefined) {
      merged[id] = inTheirs;
      takenFromTheirs.push(id);
      continue;
    }

    // Added on both sides with the same id. IDs are content-derived, so equal
    // content means equal intent and merges clean; genuinely different content
    // under one id is a conflict per differing field, not a silent pick.
    if (inBase === undefined) {
      merged[id] = mergeFields(id, undefined, inOurs!, inTheirs!, conflicts);
      continue;
    }

    // Present in all three: field-level merge.
    if (inOurs !== undefined && inTheirs !== undefined) {
      merged[id] = mergeFields(id, inBase, inOurs, inTheirs, conflicts);
      continue;
    }

    // Present in base, present on exactly one side.
    const survivor = inOurs ?? inTheirs!;
    const deletedByOurs = inOurs === undefined;
    if (clipsEqual(inBase, survivor)) {
      // The surviving side never touched it: an uncontested delete.
      deleted.push(id);
      continue;
    }
    conflicts.push({
      kind: "deleteModify",
      clipId: id,
      oursDeleted: deletedByOurs,
      theirsDeleted: !deletedByOurs,
      survivor,
    });
    merged[id] = survivor;
  }

  return merged;
}

/**
 * Pass 2. Geometric overlap on the merged result, per track.
 *
 * Runs after field merge precisely because pass 1 cannot see it: the conflicting
 * pair is made of two clips that were each merged cleanly.
 */
function overlapPass(
  merged: Record<string, Clip>,
  tracks: readonly { id: string }[],
  maxConflicts: number,
): OverlapConflict[] {
  const conflicts: OverlapConflict[] = [];
  const clips = Object.values(merged);

  for (const track of tracks) {
    const onTrack = clips
      .filter((clip) => clip.trackId === track.id)
      .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));

    // Sweep comparing each clip against the ones that can still reach it. Once
    // a clip's end is behind the current start it can never overlap again, so
    // it leaves the active window instead of being rescanned.
    let active: Clip[] = [];
    for (const clip of onTrack) {
      const end = clip.start + clip.duration;
      active = active.filter((other) => other.start + other.duration > clip.start);
      for (const other of active) {
        if (!overlaps(other, clip)) continue;
        if (conflicts.length >= maxConflicts) return conflicts;
        conflicts.push({
          kind: "overlap",
          trackId: track.id,
          a: other.id,
          b: clip.id,
          overlapStart: Math.max(other.start, clip.start),
          overlapEnd: Math.min(
            other.start + other.duration,
            clip.start + clip.duration,
          ),
        });
      }
      active.push(clip);
    }
  }
  return conflicts;
}

/**
 * Three-way merge of `theirs` into `ours`, relative to their common ancestor
 * `base`.
 */
export function mergeTimelines(
  base: Timeline,
  ours: Timeline,
  theirs: Timeline,
  options: MergeOptions = {},
): MergeResult {
  const maxOverlapConflicts = options.maxOverlapConflicts ?? 200;
  const conflicts: Conflict[] = [];
  const takenFromTheirs: string[] = [];
  const deleted: string[] = [];

  const clips = mergePass(base, ours, theirs, conflicts, takenFromTheirs, deleted);
  conflicts.push(...overlapPass(clips, ours.tracks, maxOverlapConflicts));

  return {
    merged: { ...ours, clips },
    conflicts,
    takenFromTheirs,
    deleted,
    clean: conflicts.length === 0,
  };
}

/**
 * Resolve one field conflict with an explicit choice. Kept as a function rather
 * than a mutation so the same code path serves the UI and a CLI merge tool.
 */
export function resolveField(
  result: MergeResult,
  clipId: string,
  field: MergeField,
  choice: "ours" | "theirs",
): MergeResult {
  const clip = result.merged.clips[clipId];
  if (clip === undefined) {
    throw new Error(`resolveField: no clip ${clipId} in merged timeline`);
  }
  const conflict = result.conflicts.find(
    (c): c is FieldConflict => c.kind === "field" && c.clipId === clipId && c.field === field,
  );
  if (conflict === undefined) return result;
  const resolved: Clip = { ...clip, [field]: conflict[choice] } as Clip;
  const next: Clip = {
    ...resolved,
    outPoint: resolved.inPoint + resolved.duration,
  };
  const clips = { ...result.merged.clips, [clipId]: next };
  const remaining = result.conflicts.filter(
    (c) => !(c.kind === "field" && c.clipId === clipId && c.field === field),
  );
  return {
    ...result,
    merged: { ...result.merged, clips },
    conflicts: [...remaining, ...overlapPass(clips, result.merged.tracks, 200)],
  };
}

/** Merge-order-independent view of whether a track is currently self-consistent. */
export function overlappingPairs(timeline: Timeline): readonly [string, string][] {
  const pairs: [string, string][] = [];
  for (const track of timeline.tracks) {
    const onTrack = clipsOnTrack(timeline, track.id);
    for (let i = 0; i < onTrack.length; i++) {
      for (let j = i + 1; j < onTrack.length; j++) {
        const a = onTrack[i]!;
        const b = onTrack[j]!;
        if (overlaps(a, b)) pairs.push([a.id, b.id]);
      }
    }
  }
  return pairs;
}
