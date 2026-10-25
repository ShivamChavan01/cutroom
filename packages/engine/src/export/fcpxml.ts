import { type Timeline, clipsOnTrack } from "../model";
import { DEFAULT_FPS, frameAt, msFromFrame } from "../timecode";

/**
 * FCPXML — Final Cut Pro XML.
 *
 * The interchange format Final Cut Pro writes and the one Premiere and
 * Resolve both import, so one file opens in the whole professional
 * toolchain. It carries more than EDL: assets, a spine, and per-clip
 * offsets, which is what makes a round trip preserve the cut structure.
 *
 * A caller can override the project's frame rate. Older projects default
 * to 30fps, matching their timecode readout.
 */
export interface FcpxmlOptions {
  readonly fps?: number;
  readonly width?: number;
  readonly height?: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** FCPXML durations are rational seconds, e.g. 1001/30000s. */
function rationalSeconds(frames: number, fps: number): string {
  return `${frames}/${fps}s`;
}

export function toFcpxml(timeline: Timeline, options: FcpxmlOptions = {}): string {
  const fps = options.fps ?? timeline.fps ?? DEFAULT_FPS;
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;

  const clips = timeline.tracks.flatMap((track) =>
    clipsOnTrack(timeline, track.id).map((clip) => ({ clip, trackId: track.id })),
  );
  // One asset entry per referenced media file.
  const assetIds = new Map<string, string>();
  for (const { clip } of clips) {
    if (!assetIds.has(clip.assetId)) {
      assetIds.set(clip.assetId, `r${assetIds.size + 2}`);
    }
  }
  const durationFrames = clips.reduce(
    (max, { clip }) => Math.max(max, frameAt(clip.start + clip.duration, fps)),
    0,
  );

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE fcpxml>",
    '<fcpxml version="1.10">',
    "  <resources>",
    `    <format id="r1" name="FFVideoFormat${height}p${fps}" ` +
      `frameDuration="${rationalSeconds(1, fps)}" width="${width}" height="${height}"/>`,
  ];
  for (const [assetId, resourceId] of assetIds) {
    const asset = timeline.assets[assetId];
    const duration = asset?.duration ?? 0;
    lines.push(
      `    <asset id="${resourceId}" name="${escapeXml(assetId)}" ` +
        `start="${rationalSeconds(0, fps)}" ` +
        `duration="${rationalSeconds(frameAt(duration, fps), fps)}" ` +
        `hasVideo="1" hasAudio="1" format="r1"/>`,
    );
  }
  lines.push("  </resources>");
  lines.push("  <library>");
  lines.push(`    <event name="${escapeXml(timeline.id ?? "Cutroom")}">`);
  lines.push(`      <project name="${escapeXml(timeline.id ?? "Timeline")}">`);
  lines.push(
    `        <sequence format="r1" duration="${rationalSeconds(durationFrames, fps)}" ` +
      `tcStart="${rationalSeconds(0, fps)}" tcFormat="NDF">`,
  );
  // Parallel tracks are a story of spines, one spine per track — that is how
  // Final Cut represents A-roll and B-roll, and how Premiere reads it back.
  lines.push("          <story>");
  for (const track of timeline.tracks) {
    const trackClips = clipsOnTrack(timeline, track.id);
    if (trackClips.length === 0) continue;
    lines.push("            <spine>");
    for (const clip of trackClips) {
      const resourceId = assetIds.get(clip.assetId)!;
      const startFrames = frameAt(clip.start, fps);
      const inFrames = frameAt(clip.inPoint, fps);
      const durFrames = frameAt(clip.duration, fps);
      lines.push(
        `              <asset-clip ref="${resourceId}" ` +
          `offset="${rationalSeconds(startFrames, fps)}" ` +
          `name="${escapeXml(clip.id)}" ` +
          `start="${rationalSeconds(inFrames, fps)}" ` +
          `duration="${rationalSeconds(durFrames, fps)}"/>`,
      );
    }
    lines.push("            </spine>");
  }
  lines.push("          </story>");
  lines.push("        </sequence>");
  lines.push("      </project>");
  lines.push("    </event>");
  lines.push("  </library>");
  lines.push("</fcpxml>");
  return `${lines.join("\n")}\n`;
}

/** Total timeline length in ms, from the last clip's end. */
export function fcpxmlDurationMs(timeline: Timeline, fps: number = DEFAULT_FPS): number {
  let end = 0;
  for (const track of timeline.tracks) {
    for (const clip of clipsOnTrack(timeline, track.id)) {
      end = Math.max(end, clip.start + clip.duration);
    }
  }
  return msFromFrame(frameAt(end, fps), fps);
}
