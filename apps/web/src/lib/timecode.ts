/**
 * Timecode formatting and cut navigation for the transport.
 *
 * Pure functions so the transport's behaviour is testable without a
 * player: the readout format and the "jump to previous/next cut" rule are
 * the two things a user notices when they are wrong.
 */

export const DEFAULT_FPS = 30;

export interface TimecodeOptions {
  readonly fps?: number;
}

/** HH:MM:SS:FF — frames at the given rate, non-drop-frame. */
export function formatTimecode(ms: number, options: TimecodeOptions = {}): string {
  const fps = options.fps ?? DEFAULT_FPS;
  const total = Math.max(0, ms);
  const totalSeconds = Math.floor(total / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.floor(((total % 1000) / 1000) * fps);
  const pad = (value: number, width = 2): string =>
    String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/** MM:SS.mmm — used by the timeline ruler, where sub-second precision helps. */
export function formatRulerTime(ms: number): string {
  const total = Math.max(0, ms);
  const totalSeconds = Math.floor(total / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export interface Cut {
  readonly start: number;
}

/**
 * Playhead target for "previous cut": the start of the last clip that
 * begins before the playhead. Null when the playhead is already at or
 * before the first cut.
 */
export function previousCut(cuts: readonly Cut[], playheadMs: number): number | null {
  let best: number | null = null;
  for (const cut of cuts) {
    if (cut.start < playheadMs - 1) {
      if (best === null || cut.start > best) best = cut.start;
    }
  }
  return best;
}

/**
 * Playhead target for "next cut": the start of the first clip that begins
 * after the playhead. Null when there is nothing after it.
 */
export function nextCut(cuts: readonly Cut[], playheadMs: number): number | null {
  let best: number | null = null;
  for (const cut of cuts) {
    // Strictly after the playhead: a cut the playhead already sits on is
    // the current cut, not the next one. The +1 keeps a cut 1ms away
    // reachable while still excluding the cut under the playhead.
    if (cut.start >= playheadMs + 1) {
      if (best === null || cut.start < best) best = cut.start;
    }
  }
  return best;
}
