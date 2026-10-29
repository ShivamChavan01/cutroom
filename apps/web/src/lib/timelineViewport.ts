import type { Clip } from "@cutroom/engine";
import type { TimeScale } from "./timeScale";

export interface TimelineWindow {
  readonly start: number;
  readonly end: number;
}

export function timelineWindow({
  scrollLeft,
  width,
  scale,
  overscan = 300,
}: {
  readonly scrollLeft: number;
  readonly width: number;
  readonly scale: TimeScale;
  readonly overscan?: number;
}): TimelineWindow {
  return {
    start: scale.pxToTime(Math.max(0, scrollLeft - overscan)),
    end: scale.pxToTime(Math.max(0, scrollLeft) + width + overscan),
  };
}

export function intersectsTimelineWindow(start: number, end: number, window: TimelineWindow): boolean {
  return end >= window.start && start <= window.end;
}

export function clipsInTimelineWindow(
  clips: readonly Clip[],
  window: TimelineWindow,
  pinnedIds: readonly (string | null)[] = [],
): readonly Clip[] {
  return clips.filter((clip) => pinnedIds.includes(clip.id)
    || intersectsTimelineWindow(clip.start, clip.start + clip.duration, window));
}

export function rulerTicksInTimelineWindow(
  window: TimelineWindow,
  scale: TimeScale,
  laneWidth: number,
): readonly number[] {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = (steps.find((seconds) => seconds * scale.pxPerSecond >= 80) ?? 600) * 1_000;
  const first = Math.max(0, Math.floor(window.start / step) * step);
  const end = Math.min(window.end, scale.pxToTime(laneWidth));
  const ticks: number[] = [];
  for (let ms = first; ms <= end; ms += step) ticks.push(ms);
  return ticks;
}
