import { type Timeline, clipsOnTrack } from "../model";
import { DEFAULT_FPS, formatTimecode } from "../timecode";

/**
 * CMX3600 EDL — the edit decision list every NLE reads.
 *
 * Deliberately the simplest interchange format there is: a text file of
 * cut events, each one saying "take this range of this source, put it here".
 * It carries no effects, no transitions and no metadata, which is exactly
 * why it still works when everything else does not.
 *
 * Video tracks become V events, audio tracks become A events. The clip's
 * in-point is the source in; the clip's position on the timeline is the
 * record in.
 */
export interface EdlOptions {
  readonly fps?: number;
  readonly title?: string;
}

function edlTrack(trackId: string): "V" | "A" {
  return trackId.startsWith("a") ? "A" : "V";
}

export function toEdl(timeline: Timeline, options: EdlOptions = {}): string {
  const fps = options.fps ?? DEFAULT_FPS;
  const lines: string[] = [
    `TITLE: ${options.title ?? timeline.id ?? "CUTROOM"}`,
    "FCM: NON-DROP FRAME",
    "",
  ];

  let event = 1;
  for (const track of timeline.tracks) {
    const clips = clipsOnTrack(timeline, track.id);
    if (clips.length === 0) continue;
    const code = edlTrack(track.id);
    for (const clip of clips) {
      const sourceIn = formatTimecode(clip.inPoint, { fps });
      const sourceOut = formatTimecode(clip.inPoint + clip.duration, { fps });
      const recordIn = formatTimecode(clip.start, { fps });
      const recordOut = formatTimecode(clip.start + clip.duration, { fps });
      lines.push(
        `${String(event).padStart(3, "0")}  AX       ${code}    C        ` +
          `${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`,
      );
      lines.push(`* FROM CLIP NAME: ${clip.id}`);
      event += 1;
    }
  }
  return `${lines.join("\n")}\n`;
}
