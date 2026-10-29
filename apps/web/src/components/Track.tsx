import { memo, useMemo, type CSSProperties } from "react";
import {
  type Conflict,
  type MergeResult,
  type Diagnostic,
  resolveField,
} from "@cutroom/engine";
import type { TimeScale } from "../lib/timeScale";
import { clipsInTimelineWindow, intersectsTimelineWindow, type TimelineWindow } from "../lib/timelineViewport";
import { DIFF_BORDER } from "./ClipBlock";
import type { ClipVisual } from "../lib/diffView";
import type { ConflictBand, ConflictGhost } from "../lib/mergeView";
import { resolveDeleteModify, resolveOverlap } from "../lib/vcs";
import { useClipsOnTrack, useEditorStore } from "../store";
import { ClipBlock } from "./ClipBlock";

interface TrackProps {
  readonly trackId: string;
  readonly scale: TimeScale;
  readonly laneWidth: number;
  readonly visibleWindow: TimelineWindow;
  readonly pinnedClipIds: readonly (string | null)[];
  readonly focusedConflictKey: string | null;
  readonly assetDurations: Readonly<Record<string, number>>;
  readonly diagnosticsByClip: ReadonlyMap<string, readonly Diagnostic[]>;
  readonly authors: ReadonlyMap<string, string>;
  readonly diffById: ReadonlyMap<string, ClipVisual>;
  readonly ghosts: readonly ClipVisual[];
  readonly conflictBands: readonly ConflictBand[];
  readonly conflictGhosts: readonly ConflictGhost[];
  /** The pending merge the bands came from; null when no merge is pending. */
  readonly mergeResult: MergeResult | null;
  readonly resolveConflict: (next: MergeResult) => void;
}

interface BandChoice {
  readonly label: string;
  readonly apply: (result: MergeResult) => MergeResult;
}

/** The same side-picks the merge list offers; wording must stay identical. */
function bandChoices(conflict: Conflict): readonly BandChoice[] {
  switch (conflict.kind) {
    case "assetField":
    case "trackField":
    case "assetPresence":
    case "trackPresence":
    case "trackOrder":
    case "project":
      return [];
    case "field":
      return [
        {
          label: "Keep ours",
          apply: (result) => resolveField(result, conflict.clipId, conflict.field, "ours"),
        },
        {
          label: "Take theirs",
          apply: (result) => resolveField(result, conflict.clipId, conflict.field, "theirs"),
        },
      ];
    case "deleteModify":
      return [
        {
          label: "Keep clip",
          apply: (result) => resolveDeleteModify(result, conflict.clipId, true),
        },
        {
          label: "Remove clip",
          apply: (result) => resolveDeleteModify(result, conflict.clipId, false),
        },
      ];
    case "overlap":
      return [
        {
          label: `Keep ${conflict.a}`,
          apply: (result) => resolveOverlap(result, conflict.a, conflict.b),
        },
        {
          label: `Keep ${conflict.b}`,
          apply: (result) => resolveOverlap(result, conflict.b, conflict.a),
        },
      ];
    default: {
      const _exhaustive: never = conflict;
      return _exhaustive;
    }
  }
}

const BAND_BUTTON_STYLE = {
  fontSize: 10,
  padding: "0 4px",
  border: "1px solid #f03e3e",
  background: "#331d1f",
  color: "#ffa8a8",
  cursor: "pointer",
  borderRadius: 3,
} satisfies CSSProperties;

export const Track = memo(function Track({
  trackId,
  scale,
  laneWidth,
  visibleWindow,
  pinnedClipIds,
  focusedConflictKey,
  assetDurations,
  diagnosticsByClip,
  authors,
  diffById,
  ghosts,
  conflictBands,
  conflictGhosts,
  mergeResult,
  resolveConflict,
}: TrackProps) {
  const clips = useClipsOnTrack(trackId);
  const selectClip = useEditorStore((state) => state.selectClip);
  const visibleClips = useMemo(
    () => clipsInTimelineWindow(clips, visibleWindow, pinnedClipIds),
    [clips, visibleWindow, pinnedClipIds],
  );
  const visibleGhosts = useMemo(
    () => ghosts.filter((visual) => visual.ghost !== undefined
      && intersectsTimelineWindow(visual.ghost.start, visual.ghost.start + visual.ghost.duration, visibleWindow)),
    [ghosts, visibleWindow],
  );
  const visibleConflictGhosts = useMemo(
    () => conflictGhosts.filter(({ clip }) => intersectsTimelineWindow(clip.start, clip.start + clip.duration, visibleWindow)),
    [conflictGhosts, visibleWindow],
  );
  const visibleBands = useMemo(
    () => conflictBands.filter((band) => band.key === focusedConflictKey
      || intersectsTimelineWindow(band.start, band.end, visibleWindow)),
    [conflictBands, visibleWindow, focusedConflictKey],
  );

  // Moved clips: dashed link from the old start to the new start, drawn
  // under the blocks so it reads as a trail, not a selection.
  const movedLinks = useMemo(() => clips.flatMap((clip) => {
    const visual = diffById.get(clip.id);
    if (visual?.linkFromMs === undefined) return [];
    const from = Math.min(visual.linkFromMs, clip.start);
    const to = Math.max(visual.linkFromMs, clip.start);
    if (!intersectsTimelineWindow(from, to, visibleWindow)) return [];
    return [{ key: clip.id, from, to }];
  }), [clips, diffById, visibleWindow]);

  return (
    <div
      data-track-id={trackId}
      onClick={() => selectClip(null)}
      style={{
        position: "relative",
        height: "var(--timeline-track-height, 64px)",
        width: laneWidth,
        background: "var(--color-lane)",
        borderBottom: "1px solid var(--color-border)",
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
      {visibleClips.map((clip) => {
        const visual = diffById.get(clip.id);
        return (
          <ClipBlock
            key={clip.id}
            clip={clip}
            scale={scale}
            visibleWindow={visibleWindow}
            assetDurationMs={assetDurations[clip.assetId]}
            diagnostics={diagnosticsByClip.get(clip.id) ?? []}
            author={authors.get(clip.id)}
            {...(visual !== undefined
              ? { diffTint: visual.tint, diffBadge: visual.badge }
              : {})}
          />
        );
      })}
      {visibleGhosts.map((visual) =>
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
      {visibleConflictGhosts.map((ghost) => (
        <ClipBlock
          key={`conflict-ghost-${ghost.key}`}
          clip={ghost.clip}
          scale={scale}
          assetDurationMs={undefined}
          diagnostics={[]}
          author={undefined}
          ghost
          ghostVariant="conflict"
        />
      ))}
      {mergeResult === null
        ? null
        : visibleBands.map((band) => (
            <div
              key={band.key}
              data-conflict-key={band.key}
              title={band.label}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: scale.timeToPx(band.start),
                width: Math.max(2, scale.timeToPx(band.end - band.start)),
                border: "1px solid #f03e3e",
                borderRadius: 4,
                background:
                  "repeating-linear-gradient(45deg, rgba(255,135,135,0.18), rgba(255,135,135,0.18) 3px, transparent 3px, transparent 6px)",
                zIndex: 15,
                pointerEvents: "none",
                boxSizing: "border-box",
              }}
            >
              {/* The band body stays click-through; only the chip row
                  intercepts, so clips beneath remain selectable. */}
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  left: 2,
                  maxWidth: "calc(100% - 4px)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  pointerEvents: "auto",
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    maxWidth: 240,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 10,
                    color: "#ffa8a8",
                  }}
                >
                  {band.label}
                </span>
                {bandChoices(band.conflict).map((choice) => (
                  <button
                    key={choice.label}
                    type="button"
                    title={choice.label}
                    onClick={(event) => {
                      event.stopPropagation();
                      resolveConflict(choice.apply(mergeResult));
                    }}
                    style={BAND_BUTTON_STYLE}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
    </div>
  );
});
