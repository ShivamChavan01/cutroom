import type { Clip, Timeline } from "@cutroom/engine";

interface ClipIndex {
  readonly byTrack: ReadonlyMap<string, readonly Clip[]>;
  readonly duration: number;
}

const indexes = new WeakMap<Timeline["clips"], ClipIndex>();
const EMPTY_CLIPS: readonly Clip[] = [];

function indexClips(clips: Timeline["clips"]): ClipIndex {
  const cached = indexes.get(clips);
  if (cached !== undefined) return cached;

  const byTrack = new Map<string, Clip[]>();
  let duration = 0;
  for (const clip of Object.values(clips)) {
    const group = byTrack.get(clip.trackId);
    if (group === undefined) byTrack.set(clip.trackId, [clip]);
    else group.push(clip);
    const end = clip.start + clip.duration;
    if (end > duration) duration = end;
  }
  for (const group of byTrack.values()) {
    group.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  }
  const index: ClipIndex = { byTrack, duration };
  indexes.set(clips, index);
  return index;
}

// Clip operations replace the immutable clips record; playhead and metadata
// updates keep it, so all readers can share one index without invalidation hooks.
export function indexedClipsOnTrack(timeline: Timeline, trackId: string): readonly Clip[] {
  return indexClips(timeline.clips).byTrack.get(trackId) ?? EMPTY_CLIPS;
}

export function indexedTimelineDuration(timeline: Timeline): number {
  return indexClips(timeline.clips).duration;
}
