import { clipsOnTrack, type Clip, type Timeline, type Track } from "@cutroom/engine";

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

export interface PlaybackLayer extends ActiveClip {
  readonly track: Track;
}

export function resolvePlaybackLayers(
  timeline: Timeline,
  playheadMs: number,
  hiddenTrackIds: readonly string[] = [],
): readonly PlaybackLayer[] {
  const layers: PlaybackLayer[] = [];
  for (const track of timeline.tracks) {
    if (hiddenTrackIds.includes(track.id)) continue;
    const active = resolveActiveClip(clipsOnTrack(timeline, track.id), playheadMs);
    if (active !== null) layers.push({ ...active, track });
  }
  return layers;
}

export function playbackGain(clip: Clip, track: Track, mutedTrackIds: readonly string[] = []): number {
  return track.muted || mutedTrackIds.includes(track.id)
    ? 0
    : Math.min(1, Math.max(0, clip.volume));
}

export function clipTransform(clip: Clip): string {
  return `translate(${clip.x ?? 0}px, ${clip.y ?? 0}px) rotate(${clip.rotation ?? 0}deg) scale(${clip.scaleX ?? 1}, ${clip.scaleY ?? 1})`;
}

export function advancePlayback({
  at, previousFrame, frame, duration,
}: {
  readonly at: number;
  readonly previousFrame: number | null;
  readonly frame: number;
  readonly duration: number;
}): { readonly time: number; readonly ended: boolean } {
  const elapsed = previousFrame === null ? 0 : Math.max(0, frame - previousFrame);
  const time = Math.min(duration, at + elapsed);
  return { time, ended: time >= duration };
}
