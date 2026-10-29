import { detachedAudioId, overlaps, type Op, type Timeline } from "@cutroom/engine";

type DetachPlan =
  | { readonly kind: "ready"; readonly op: Extract<Op, { type: "detachAudio" }>; readonly trackName: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export function planAudioDetach(timeline: Timeline, clipId: string | null, lockedTracks: readonly string[]): DetachPlan {
  const clip = clipId === null ? undefined : timeline.clips[clipId];
  if (clip === undefined || timeline.assets[clip.assetId]?.kind !== "video" ||
      timeline.tracks.find((track) => track.id === clip.trackId)?.kind !== "video") {
    return { kind: "unavailable", reason: "Select a video clip to detach its audio." };
  }
  if (lockedTracks.includes(clip.trackId)) return { kind: "unavailable", reason: "Unlock the video track before detaching audio." };
  const audioId = detachedAudioId(clip.id);
  if (Object.keys(timeline.clips).some((id) => id === audioId || id.startsWith(`${audioId}~`))) {
    return { kind: "unavailable", reason: "Audio has already been detached from this clip." };
  }
  const clips = Object.values(timeline.clips);
  const target = timeline.tracks.find((track) => track.kind === "audio" && !lockedTracks.includes(track.id) &&
    !clips.some((other) => other.trackId === track.id && overlaps(other, clip)));
  if (target !== undefined) return { kind: "ready", op: { type: "detachAudio", clipId: clip.id, trackId: target.id }, trackName: target.name };
  let number = 1;
  while (timeline.tracks.some((track) => track.id === `a${number}`) || lockedTracks.includes(`a${number}`)) number++;
  const trackId = `a${number}`;
  return { kind: "ready", op: { type: "detachAudio", clipId: clip.id, trackId }, trackName: trackId.toUpperCase() };
}
