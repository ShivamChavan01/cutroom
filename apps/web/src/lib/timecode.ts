/**
 * Timecode formatting and cut navigation for the transport.
 *
 * `formatTimecode` lives in the engine (it is also what the export formats
 * use) — re-exported here so the UI imports it from one place.
 */
export { formatTimecode, DEFAULT_FPS, frameAt, msFromFrame } from "@cutroom/engine";

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
