import type {
  Clip,
  Conflict,
  MergeResult,
  Millis,
  Timeline,
} from "@cutroom/engine";

/**
 * A pending merge's conflicts to in-place timeline visuals, as a pure
 * mapping (the diff view's pattern). One band per conflict, spanning the
 * region the clash occupies, plus dashed ghosts for merged candidates not
 * already visible in the working timeline. Bands carry the conflict objects
 * themselves so the timeline can resolve them with the same resolvers the
 * merge list uses — the mapping only decides how each conflict looks.
 */

export interface ConflictBand {
  /** Stable across re-derivation: index, kind, principal clip id. */
  readonly key: string;
  readonly conflict: Conflict;
  readonly index: number;
  readonly trackId: string;
  readonly start: Millis;
  readonly end: Millis;
  readonly label: string;
}

export interface ConflictGhost {
  readonly key: string;
  /** The merged candidate, at its merged position. */
  readonly clip: Clip;
}

export interface ConflictVisuals {
  readonly bandsByTrack: ReadonlyMap<string, readonly ConflictBand[]>;
  readonly ghostsByTrack: ReadonlyMap<string, readonly ConflictGhost[]>;
}

/**
 * All kind-local knowledge in one exhaustive switch: band geometry, label,
 * principal id, and the clips worth ghosting. A new Conflict variant fails
 * to compile here before it can fail in the UI.
 */
interface BandParts {
  readonly trackId: string;
  readonly start: Millis;
  readonly end: Millis;
  readonly principalId: string;
  readonly label: string;
  /** Ghost candidates: conflict participants not already visible in place. */
  readonly candidateIds: readonly string[];
}

function bandParts(conflict: Conflict, merged: Timeline): BandParts | null {
  switch (conflict.kind) {
    case "project":
      return null;
    case "field": {
      // The merged clip keeps ours for conflicted fields, so the band sits
      // where the two sides actually disagree. Ours is visible by
      // construction, so field conflicts carry no ghost.
      const clip = merged.clips[conflict.clipId];
      if (clip === undefined) {
        throw new Error(
          `mergeView: field conflict names clip ${conflict.clipId}, absent from the merged timeline`,
        );
      }
      return {
        trackId: clip.trackId,
        start: clip.start,
        end: clip.start + clip.duration,
        principalId: conflict.clipId,
        label: `[field] ${conflict.clipId}.${conflict.field}`,
        candidateIds: [],
      };
    }
    case "deleteModify":
      return {
        trackId: conflict.survivor.trackId,
        start: conflict.survivor.start,
        end: conflict.survivor.start + conflict.survivor.duration,
        principalId: conflict.clipId,
        label: `[delete-vs-edit] ${conflict.clipId}`,
        candidateIds: [conflict.clipId],
      };
    case "overlap":
      return {
        trackId: conflict.trackId,
        start: conflict.overlapStart,
        end: conflict.overlapEnd,
        principalId: conflict.a,
        label: `[overlap] ${conflict.a} × ${conflict.b}`,
        candidateIds: [conflict.a, conflict.b],
      };
    default: {
      const _exhaustive: never = conflict;
      return _exhaustive;
    }
  }
}

/** True when the working timeline already shows this candidate in place. */
function visibleInPlace(working: Timeline, candidate: Clip): boolean {
  const present = working.clips[candidate.id];
  return (
    present !== undefined &&
    present.trackId === candidate.trackId &&
    present.start === candidate.start &&
    present.duration === candidate.duration
  );
}

export function conflictsToVisuals(
  result: MergeResult,
  working: Timeline,
): ConflictVisuals {
  const bands = new Map<string, ConflictBand[]>();
  const ghosts = new Map<string, ConflictGhost[]>();
  const ghosted = new Set<string>();

  result.conflicts.forEach((conflict, index) => {
    const parts = bandParts(conflict, result.merged);
    if (parts === null) return;
    const bandList = bands.get(parts.trackId) ?? [];
    bands.set(parts.trackId, [
      ...bandList,
      {
        key: `${index}:${conflict.kind}:${parts.principalId}`,
        conflict,
        index,
        trackId: parts.trackId,
        start: parts.start,
        end: parts.end,
        label: parts.label,
      },
    ]);

    for (const clipId of parts.candidateIds) {
      const candidate = result.merged.clips[clipId];
      // A clip a resolver already dropped has no candidate left to show;
      // the neighbouring conflicts that still name it get no ghost.
      if (candidate === undefined) continue;
      if (visibleInPlace(working, candidate) || ghosted.has(clipId)) continue;
      ghosted.add(clipId);
      const ghostList = ghosts.get(candidate.trackId) ?? [];
      ghosts.set(candidate.trackId, [
        ...ghostList,
        { key: clipId, clip: candidate },
      ]);
    }
  });

  return { bandsByTrack: bands, ghostsByTrack: ghosts };
}
