import type { Op } from "@cutroom/engine";

/**
 * The op log rendered as English. Pure formatting of stored data — op type
 * plus author plus params — so the feed can never disagree with history.
 * Times render in seconds; the engine stores ms.
 */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function describeOp(op: Op): string {
  switch (op.type) {
    case "addClip":
      return `added ${op.clip.id} on ${op.clip.trackId} at ${seconds(op.clip.start)}`;
    case "deleteClip":
      return `deleted ${op.clipId}`;
    case "splitClip":
      return `split ${op.clipId} at +${seconds(op.at)}`;
    case "trimClip": {
      const parts: string[] = [];
      if (op.inPoint !== undefined) parts.push(`in ${seconds(op.inPoint)}`);
      if (op.duration !== undefined) parts.push(`dur ${seconds(op.duration)}`);
      return `trimmed ${op.clipId}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
    }
    case "moveClip":
      return `moved ${op.clipId} to ${seconds(op.start)}${op.trackId !== undefined ? ` on ${op.trackId}` : ""}`;
    case "setVolume":
      return `set ${op.clipId} volume to ${op.volume}`;
  }
}
