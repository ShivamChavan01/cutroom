import { type Clip, type Timeline } from "./model";

/**
 * Clip-level diff between two timelines.
 *
 * Because clips are keyed by identity, the diff is a set operation over IDs
 * rather than an LCS over an array. This is the payoff of the map-not-array
 * decision: a clip that moved one slot reports as `moved`, not as an
 * unrelated delete plus add that happens to contain the same pixels.
 */

export type ClipChange =
  | { readonly kind: "added"; readonly clip: Clip }
  | { readonly kind: "removed"; readonly clip: Clip }
  | { readonly kind: "moved"; readonly before: Clip; readonly after: Clip }
  | {
      readonly kind: "trimmed";
      readonly before: Clip;
      readonly after: Clip;
      /** Positive when material was revealed, negative when it was cut away. */
      readonly deltaIn: number;
      readonly deltaDuration: number;
    }
  | {
      readonly kind: "edited";
      readonly before: Clip;
      readonly after: Clip;
      /** Fields that actually differ, so the UI can label the change. */
      readonly fields: readonly (keyof Clip)[];
    };

export interface Diff {
  readonly changes: readonly ClipChange[];
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  readonly unchanged: number;
}

function samePosition(a: Clip, b: Clip): boolean {
  return a.start === b.start && a.trackId === b.trackId;
}

/**
 * Compare only the fields an editor thinks of as "the cut". `id` is by
 * construction equal (it is the join key) and `outPoint` is derived from
 * inPoint + duration, so including it would report a phantom change on every
 * trim.
 */
const EDITABLE_FIELDS = ["assetId", "inPoint", "duration", "volume"] as const;

export function diffTimelines(before: Timeline, after: Timeline): Diff {
  const beforeIds = Object.keys(before.clips);
  const afterIds = Object.keys(after.clips);
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);

  const changes: ClipChange[] = [];

  for (const id of afterIds) {
    const next = after.clips[id]!;
    const prev = before.clips[id];
    if (prev === undefined) {
      changes.push({ kind: "added", clip: next });
      continue;
    }
    if (samePosition(prev, next)) {
      const fields = EDITABLE_FIELDS.filter((field) => prev[field] !== next[field]);
      const deltaIn = next.inPoint - prev.inPoint;
      const deltaDuration = next.duration - prev.duration;
      if (deltaIn !== 0 || deltaDuration !== 0) {
        changes.push({
          kind: "trimmed",
          before: prev,
          after: next,
          deltaIn,
          deltaDuration,
        });
      } else if (fields.length > 0) {
        changes.push({ kind: "edited", before: prev, after: next, fields });
      }
    } else {
      changes.push({ kind: "moved", before: prev, after: next });
    }
  }

  for (const id of beforeIds) {
    if (!afterSet.has(id)) {
      changes.push({ kind: "removed", clip: before.clips[id]! });
    }
  }

  // Stable ordering: removals and additions in id order, then changes, so the
  // diff view does not reshuffle between renders.
  changes.sort((a, b) => {
    const rank = (c: ClipChange): number =>
      c.kind === "added" ? 0 : c.kind === "removed" ? 1 : 2;
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    const idOf = (c: ClipChange): string =>
      c.kind === "added" || c.kind === "removed" ? c.clip.id : c.after.id;
    return idOf(a) < idOf(b) ? -1 : 1;
  });

  const unchanged = beforeIds.filter((id) => afterSet.has(id)).length - changes.filter(
    (c) => c.kind !== "added" && c.kind !== "removed",
  ).length;

  return {
    changes,
    added: changes.filter((c) => c.kind === "added").length,
    removed: changes.filter((c) => c.kind === "removed").length,
    changed: changes.filter(
      (c) => c.kind !== "added" && c.kind !== "removed",
    ).length,
    unchanged,
  };
}

/** Was `before` derived from `after` with no divergent edits? Cheap ancestor check. */
export function isUnchanged(before: Timeline, after: Timeline): boolean {
  return diffTimelines(before, after).changes.length === 0;
}
