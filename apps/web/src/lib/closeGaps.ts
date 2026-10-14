import { type Op, type Timeline, clipsOnTrack } from "@cutroom/engine";

/**
 * Ripple-close every gap on every track: walk each lane in start order,
 * pulling each clip left against the cursor. Pure op builder — the caller
 * dispatches the returned ops (one history entry per clip moved, so undo
 * stays per-clip).
 */
export function closeGapsOps(timeline: Timeline): Op[] {
  const ops: Op[] = [];
  for (const track of timeline.tracks) {
    let cursor = 0;
    for (const clip of clipsOnTrack(timeline, track.id)) {
      if (clip.start > cursor) {
        ops.push({ type: "moveClip", clipId: clip.id, start: cursor });
        cursor += clip.duration;
      } else {
        cursor = Math.max(cursor, clip.start + clip.duration);
      }
    }
  }
  return ops;
}
