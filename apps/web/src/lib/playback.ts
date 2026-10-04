import type { Clip } from "@cutroom/engine";

/**
 * Playback resolution: which clip owns the playhead, and where inside its
 * source media to read from. Pure — no DOM, no <video> — so the boundary
 * logic is testable without a browser.
 *
 * Clips must be sorted by start (the engine's clipsOnTrack guarantees this).
 * Intervals are half-open: a playhead exactly on a boundary belongs to the
 * clip starting there, never the one ending there.
 */
export interface ActiveClip {
  readonly clip: Clip;
  readonly sourceTimeMs: number;
}

export function resolveActiveClip(
  clips: readonly Clip[],
  playheadMs: number,
): ActiveClip | null {
  for (const clip of clips) {
    if (playheadMs < clip.start) {
      // Sorted order: nothing later can cover an earlier playhead.
      return null;
    }
    if (playheadMs < clip.start + clip.duration) {
      return {
        clip,
        sourceTimeMs: clip.inPoint + (playheadMs - clip.start),
      };
    }
  }
  return null;
}

/** The clip after `clip`, if any — used to preload the next source. */
export function nextClip(
  clips: readonly Clip[],
  clip: Clip,
): Clip | null {
  const index = clips.findIndex((candidate) => candidate.id === clip.id);
  if (index === -1 || index + 1 >= clips.length) return null;
  return clips[index + 1] ?? null;
}
