import type { Clip, ClipChange, Diff } from "@cutroom/engine";

/**
 * Diff entries to visual states, as a pure mapping.
 *
 * The engine's `diffTimelines` output is the only diff implementation; this
 * module only decides how each entry looks. Every state carries a text cue
 * (badge) so nothing relies on colour alone, and removed clips become
 * ghosts: the *old* clip rendered dashed at its *old* position.
 */

export type DiffTint = "added" | "removed" | "moved" | "trimmed" | "edited";

export interface ClipVisual {
  /** Id of the live clip this annotates, or the removed clip for ghosts. */
  readonly clipId: string;
  readonly tint: DiffTint;
  readonly badge: string;
  /** Set for removed clips: render this old clip, dashed, non-interactive. */
  readonly ghost?: Clip;
  /** Set for moved clips: old start ms, to draw a link old -> new. */
  readonly linkFromMs?: number;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function changeToVisual(change: ClipChange): ClipVisual {
  switch (change.kind) {
    case "added":
      return { clipId: change.clip.id, tint: "added", badge: "+ added" };
    case "removed":
      return {
        clipId: change.clip.id,
        tint: "removed",
        badge: "− removed",
        ghost: change.clip,
      };
    case "moved": {
      const delta = change.after.start - change.before.start;
      const arrow = delta >= 0 ? "→" : "←";
      return {
        clipId: change.after.id,
        tint: "moved",
        badge: `moved ${arrow} ${seconds(Math.abs(delta))}`,
        linkFromMs: change.before.start,
      };
    }
    case "trimmed": {
      const parts: string[] = [];
      if (change.deltaIn !== 0) parts.push(`in ${seconds(change.deltaIn)}`);
      if (change.deltaDuration !== 0) {
        parts.push(`dur ${change.deltaDuration > 0 ? "+" : ""}${seconds(change.deltaDuration)}`);
      }
      return {
        clipId: change.after.id,
        tint: "trimmed",
        badge: `trimmed ${parts.join(", ")}`,
      };
    }
    case "edited":
      return {
        clipId: change.after.id,
        tint: "edited",
        badge: `~ ${change.fields.join(", ")}`,
      };
  }
}

export interface DiffVisuals {
  /** Live clip id -> visual. */
  readonly byId: ReadonlyMap<string, ClipVisual>;
  /** Ghosts (removed clips), grouped by track id for lane rendering. */
  readonly ghostsByTrack: ReadonlyMap<string, readonly ClipVisual[]>;
}

export function diffToVisuals(diff: Diff): DiffVisuals {
  const byId = new Map<string, ClipVisual>();
  const ghosts = new Map<string, ClipVisual[]>();
  for (const change of diff.changes) {
    const visual = changeToVisual(change);
    if (visual.ghost !== undefined) {
      const list = ghosts.get(visual.ghost.trackId) ?? [];
      ghosts.set(visual.ghost.trackId, [...list, visual]);
    } else {
      byId.set(visual.clipId, visual);
    }
  }
  return { byId, ghostsByTrack: ghosts };
}
