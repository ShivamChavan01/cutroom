import { type Timeline } from "../model";

/**
 * Cutroom's own timeline file — lossless, and the only format that can
 * round-trip everything (assets, tracks, clip ids).
 *
 * The interchange formats deliberately drop things: an EDL has no asset
 * ids, an FCPXML spine has no notion of a parallel audio track. This one
 * keeps the whole model, so it is the format to use when the destination is
 * Cutroom itself, or when an EDL would lose too much.
 */
export const CUTROOM_FILE_VERSION = 1;

export interface CutroomFile {
  readonly version: number;
  readonly timeline: Timeline;
}

export function toCutroomFile(timeline: Timeline): string {
  const file: CutroomFile = { version: CUTROOM_FILE_VERSION, timeline };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function fromCutroomFile(raw: string): Timeline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("not a Cutroom file: invalid JSON");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error("not a Cutroom file: expected an object");
  }
  const candidate = parsed as Partial<CutroomFile>;
  if (candidate.version !== CUTROOM_FILE_VERSION) {
    throw new Error(
      `unsupported Cutroom file version ${String(candidate.version)} ` +
        `(this build reads ${CUTROOM_FILE_VERSION})`,
    );
  }
  const timeline = candidate.timeline;
  if (
    timeline === undefined ||
    typeof timeline !== "object" ||
    typeof timeline.clips !== "object" ||
    !Array.isArray(timeline.tracks)
  ) {
    throw new Error("not a Cutroom file: missing timeline");
  }
  return timeline;
}
