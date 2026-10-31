import { type Asset, type Clip, type Timeline, TRANSFORM_DEFAULTS, TRANSFORM_FIELDS } from "./model";

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
  readonly metadataChanges?: readonly ("id" | "fps" | "tracks" | "assets")[];
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
const EDITABLE_FIELDS = ["assetId", "inPoint", "duration", "volume", ...TRANSFORM_FIELDS] as const;

function equalClipField(a: Clip, b: Clip, field: (typeof EDITABLE_FIELDS)[number]): boolean {
  if (field === "x" || field === "y" || field === "scaleX" || field === "scaleY" || field === "rotation") {
    return (a[field] ?? TRANSFORM_DEFAULTS[field]) === (b[field] ?? TRANSFORM_DEFAULTS[field]);
  }
  return a[field] === b[field];
}

/** Semantic clip equality, including implicit transform defaults and excluding derived outPoint. */
export function sameClip(a: Clip | undefined, b: Clip | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a === b || (a.id === b.id && samePosition(a, b) && EDITABLE_FIELDS.every(field => equalClipField(a, b, field)));
}

function sameAsset(a: Asset | undefined, b: Asset | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const fields = ["id", "kind", "duration", "width", "height", "bytes", "proxyId", "name", "mimeType"] as const;
  return fields.every((field) => a[field] === b[field]) &&
    (a.tags ?? []).length === (b.tags ?? []).length &&
    (a.tags ?? []).every((tag, index) => tag === b.tags?.[index]);
}

function metadataChanges(before: Timeline, after: Timeline): NonNullable<Diff["metadataChanges"]> {
  const changes: ("id" | "fps" | "tracks" | "assets")[] = [];
  if (before.id !== after.id) changes.push("id");
  if ((before.fps ?? 30) !== (after.fps ?? 30)) changes.push("fps");
  if (before.tracks.length !== after.tracks.length || before.tracks.some((track, index) => {
    const next = after.tracks[index];
    return next === undefined || track.id !== next.id || track.kind !== next.kind || track.name !== next.name || track.muted !== next.muted;
  })) changes.push("tracks");
  const assetIds = new Set([...Object.keys(before.assets), ...Object.keys(after.assets)]);
  if ([...assetIds].some((id) => !sameAsset(before.assets[id], after.assets[id]))) changes.push("assets");
  return changes;
}

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
      const fields = EDITABLE_FIELDS.filter((field) => !equalClipField(prev, next, field));
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
    metadataChanges: metadataChanges(before, after),
  };
}

/** Was `before` derived from `after` with no divergent edits? Cheap ancestor check. */
export function isUnchanged(before: Timeline, after: Timeline): boolean {
  const diff = diffTimelines(before, after);
  return diff.changes.length === 0 && (diff.metadataChanges?.length ?? 0) === 0;
}
