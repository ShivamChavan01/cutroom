/**
 * Time <-> pixel math for the timeline. Pure functions, no React, no DOM.
 * Every rendered position derives from one TimeScale built from the store's
 * pxPerSecond (zoom), so zoom changes propagate through a single value.
 */
export interface TimeScale {
  readonly pxPerSecond: number;
  readonly timeToPx: (ms: number) => number;
  readonly pxToTime: (px: number) => number;
}

export function createTimeScale(pxPerSecond: number): TimeScale {
  if (!(pxPerSecond > 0)) {
    throw new Error(`createTimeScale: pxPerSecond must be positive, got ${pxPerSecond}`);
  }
  return {
    pxPerSecond,
    timeToPx: (ms) => (ms / 1000) * pxPerSecond,
    pxToTime: (px) => (px / pxPerSecond) * 1000,
  };
}
