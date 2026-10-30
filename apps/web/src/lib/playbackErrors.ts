export interface PlaybackError {readonly assetId: string; readonly message: string}
export type PlaybackEvent = {readonly kind: "failed"; readonly trackId: string; readonly assetId: string; readonly message: string}
  | {readonly kind: "ready"; readonly trackId: string; readonly assetId: string};

/** Readiness on one track cannot clear another track's failed source. */
export function updatePlaybackErrors(errors: ReadonlyMap<string, PlaybackError>, event: PlaybackEvent): ReadonlyMap<string, PlaybackError> {
  if (event.kind === "ready" && errors.get(event.trackId)?.assetId !== event.assetId) return errors;
  const next = new Map(errors);
  if (event.kind === "failed") next.set(event.trackId, {assetId: event.assetId, message: event.message});
  else next.delete(event.trackId);
  return next;
}
