import { memo } from "react";
import type { Diagnostic } from "@cutroom/engine";
import type { TimeScale } from "../lib/timeScale";
import { DIFF_BORDER } from "./ClipBlock";
import type { ClipVisual } from "../lib/diffView";
import { useClipsOnTrack, useEditorStore } from "../store";
import { ClipBlock } from "./ClipBlock";

interface TrackProps {
  readonly trackId: string;
  readonly scale: TimeScale;
  readonly laneWidth: number;
  readonly assetDurations: Readonly<Record<string, number>>;
  readonly diagnosticsByClip: ReadonlyMap<string, readonly Diagnostic[]>;
  readonly authors: ReadonlyMap<string, string>;
  readonly diffById: ReadonlyMap<string, ClipVisual>;
  readonly ghosts: readonly ClipVisual[];
}

export const Track = memo(function Track({
  trackId,
  scale,
  laneWidth,
  assetDurations,
  diagnosticsByClip,
  authors,
  diffById,
  ghosts,
}: TrackProps) {
  const clips = useClipsOnTrack(trackId);
  const selectClip = useEditorStore((state) => state.selectClip);

  // Moved clips: dashed link from the old start to the new start, drawn
  // under the blocks so it reads as a trail, not a selection.
  const movedLinks = clips.flatMap((clip) => {
    const visual = diffById.get(clip.id);
    if (visual?.linkFromMs === undefined) return [];
    const from = Math.min(visual.linkFromMs, clip.start);
    const to = Math.max(visual.linkFromMs, clip.start);
    return [{ key: clip.id, from, to }];
  });

  return (
    <div
      onClick={() => selectClip(null)}
      style={{
        position: "relative",
        height: 44,
        width: laneWidth,
        background: "#1a1b1e",
        borderBottom: "1px solid #2c2e33",
      }}
    >
      {movedLinks.map((link) => (
        <div
          key={`link-${link.key}`}
          aria-hidden
          style={{
            position: "absolute",
            top: 20,
            left: scale.timeToPx(link.from),
            width: Math.max(2, scale.timeToPx(link.to - link.from)),
            borderTop: `2px dashed ${DIFF_BORDER.moved}`,
            opacity: 0.7,
            pointerEvents: "none",
          }}
        />
      ))}
      {clips.map((clip) => {
        const visual = diffById.get(clip.id);
        return (
          <ClipBlock
            key={clip.id}
            clip={clip}
            scale={scale}
            assetDurationMs={assetDurations[clip.assetId]}
            diagnostics={diagnosticsByClip.get(clip.id) ?? []}
            author={authors.get(clip.id)}
            {...(visual !== undefined
              ? { diffTint: visual.tint, diffBadge: visual.badge }
              : {})}
          />
        );
      })}
      {ghosts.map((visual) =>
        visual.ghost === undefined ? null : (
          <ClipBlock
            key={`ghost-${visual.clipId}`}
            clip={visual.ghost}
            scale={scale}
            assetDurationMs={undefined}
            diagnostics={[]}
            author={undefined}
            diffTint={visual.tint}
            diffBadge={visual.badge}
            ghost
          />
        ),
      )}
    </div>
  );
});
