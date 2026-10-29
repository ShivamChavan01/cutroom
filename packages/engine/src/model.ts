/**
 * Timeline data model.
 *
 * The one structural decision everything else depends on: clips are held in an
 * ID-keyed record, not an array. In an array, "the clip moved from index 2 to
 * index 5" and "clip A was deleted and clip B was inserted" produce the same
 * observable state, so a diff cannot tell them apart and every shift looks like
 * a delete plus an add. Keying by stable identity makes position a *field of
 * the clip* (`start`), which is what makes `diff` and `merge` tractable.
 *
 * Ordering within a track is therefore derived, not stored: see `clipsOnTrack`.
 */

export type Millis = number;

/** Ordered list of track ids. Order is the only positional data in the model. */
export type TrackIds = readonly string[];

export const TRANSFORM_DEFAULTS = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } as const;
export type TransformField = keyof typeof TRANSFORM_DEFAULTS;
export const TRANSFORM_FIELDS: readonly TransformField[] = ["x", "y", "scaleX", "scaleY", "rotation"];

export interface Clip {
  /** Stable, content-derived identity. Never positional. */
  readonly id: string;
  readonly trackId: string;
  /** Content-addressed asset id (`sha256(file)`), not a filename. */
  readonly assetId: string;
  /** Where this clip sits on the timeline. */
  readonly start: Millis;
  /** Where playback begins inside the source asset. */
  readonly inPoint: Millis;
  readonly duration: Millis;
  /** Linear gain in [0, 1]. 1 = untouched. */
  readonly volume: number;
  /** Asset-local end offset. Derived from inPoint + duration, cached for reads. */
  readonly outPoint: Millis;
  readonly x?: number;
  readonly y?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotation?: number;
}

export interface Track {
  readonly id: string;
  readonly kind: "video" | "audio";
  readonly name: string;
  /** Muted tracks still occupy the timeline; they just contribute no output. */
  readonly muted: boolean;
}

/**
 * An asset is referenced by hash before its bytes are necessarily local.
 * This is the honest slice of the "large asset sync" problem: timeline
 * structure travels first, media follows.
 */
export interface Asset {
  readonly id: string;
  readonly kind: "video" | "audio" | "image";
  /** Duration of the full source file. Needed to validate trims. */
  readonly duration: Millis;
  readonly width?: number;
  readonly height?: number;
  readonly bytes?: number;
  /** Content-hash of the low-res proxy, if one has been generated. */
  readonly proxyId?: string;
  readonly name?: string;
  readonly mimeType?: string;
  readonly tags?: readonly string[];
}

export interface Timeline {
  readonly id: string;
  readonly fps?: number;
  readonly clips: Readonly<Record<string, Clip>>;
  readonly tracks: readonly Track[];
  readonly assets: Readonly<Record<string, Asset>>;
}

/** Zero-length clips carry no content and would poison every geometric check. */
export function clipIsWellFormed(clip: Clip): boolean {
  return (
    [clip.start, clip.inPoint, clip.duration, clip.outPoint, clip.volume].every(Number.isFinite) &&
    clip.start >= 0 && clip.volume >= 0 && clip.volume <= 1 &&
    clip.duration > 0 &&
    clip.inPoint >= 0 &&
    clip.outPoint === clip.inPoint + clip.duration &&
    TRANSFORM_FIELDS.every((field) => {
      const value = clip[field] ?? TRANSFORM_DEFAULTS[field];
      return Number.isFinite(value) && (!(field === "scaleX" || field === "scaleY") || (value > 0 && value <= 20));
    })
  );
}

export function outPointOf(clip: Pick<Clip, "inPoint" | "duration">): Millis {
  return clip.inPoint + clip.duration;
}

/**
 * Derived ordering. Explicitly *not* stored: if ordering were part of the
 * record it would become a second source of truth that can disagree with
 * `start` after a merge.
 */
export function clipsOnTrack(
  timeline: Timeline,
  trackId: string,
): readonly Clip[] {
  return Object.values(timeline.clips)
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

/**
 * Half-open interval: [start, start + duration). Timeline clock, not the
 * asset-local outPoint — a clip that starts at 12s occupies [12s, 14s] on
 * the timeline even though its asset-local outPoint is 2s. A zero-length
 * gap does not overlap.
 */
export function overlaps(a: Clip, b: Clip): boolean {
  return a.start < b.start + b.duration && b.start < a.start + a.duration;
}

export function emptyTimeline(id = "untitled"): Timeline {
  return {
    id,
    clips: {},
    tracks: [
      { id: "v1", kind: "video", name: "V1", muted: false },
      { id: "a1", kind: "audio", name: "A1", muted: false },
    ],
    assets: {},
  };
}

export function timelineDuration(timeline: Timeline): Millis {
  let max = 0;
  for (const clip of Object.values(timeline.clips)) {
    const end = clip.start + clip.duration;
    if (end > max) max = end;
  }
  return max;
}
