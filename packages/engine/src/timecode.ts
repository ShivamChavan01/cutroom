/**
 * Timecode formatting, shared by the editor UI and the export formats.
 *
 * The timeline stores milliseconds. Interchange formats (EDL, FCPXML) want
 * HH:MM:SS:FF at a specific frame rate, so one implementation here keeps
 * the UI readout and the exported files from disagreeing.
 */

export const DEFAULT_FPS = 30;

export interface TimecodeOptions {
  readonly fps?: number;
}

/** HH:MM:SS:FF — non-drop-frame, as used by EDL and by the transport. */
export function formatTimecode(ms: number, options: TimecodeOptions = {}): string {
  const fps = options.fps ?? DEFAULT_FPS;
  const total = Math.max(0, ms);
  const totalSeconds = Math.floor(total / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.floor(((total % 1000) / 1000) * fps);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/** Frame index at a given rate — the unit FCPXML and EDL count in. */
export function frameAt(ms: number, fps: number = DEFAULT_FPS): number {
  return Math.floor((Math.max(0, ms) / 1000) * fps);
}

/** Milliseconds from a frame index at a given rate. */
export function msFromFrame(frame: number, fps: number = DEFAULT_FPS): number {
  return Math.round((frame / fps) * 1000);
}
