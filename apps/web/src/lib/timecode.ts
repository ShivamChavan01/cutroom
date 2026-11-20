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

export function indexCutStarts(cuts: readonly Cut[]): readonly number[] {
  return [...new Set(cuts.map(cut => cut.start))].sort((a, b) => a - b);
}

function lowerBound(sortedStarts: readonly number[], time: number): number {
  let low = 0;
  let high = sortedStarts.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (sortedStarts[middle]! < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Playhead target for "previous cut": the start of the last clip that
 * begins before the playhead. Null when the playhead is already at or
 * before the first cut.
 */
export function previousCut(sortedStarts: readonly number[], playheadMs: number): number | null {
  return sortedStarts[lowerBound(sortedStarts, playheadMs - 1) - 1] ?? null;
}

/**
 * Playhead target for "next cut": the start of the first clip that begins
 * after the playhead. Null when there is nothing after it.
 */
export function nextCut(sortedStarts: readonly number[], playheadMs: number): number | null {
  if (Number.isNaN(playheadMs)) return null;
  // A cut one millisecond ahead is reachable, while the current cut is excluded.
  return sortedStarts[lowerBound(sortedStarts, playheadMs + 1)] ?? null;
}
