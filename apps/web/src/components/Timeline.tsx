import { useMemo, useState } from "react";
import { authorsByClip, lint, timelineDuration } from "@cutroom/engine";
import { diffToVisuals, type ClipVisual } from "../lib/diffView";
import { uploadFiles } from "../lib/upload";
import { createTimeScale } from "../lib/timeScale";
import { useEditorStore, usePlayhead, useTrackIds } from "../store";
import { useVcsStore } from "../vcsStore";
import { Track } from "./Track";
import { TimeRuler } from "./TimeRuler";

/** Trailing space so the last clip never sits flush against the edge. */
const TAIL_MS = 5_000;

// Stable empty references: passing fresh `{}` / `[]` per render would defeat
// Track's memo on every playhead tick when no diff is active.
const EMPTY_MAP: ReadonlyMap<string, ClipVisual> = new Map();
const EMPTY_LIST: readonly ClipVisual[] = [];

export function Timeline() {
  const history = useEditorStore((state) => state.history);
  const timeline = useEditorStore((state) => state.timeline);
  const trackIds = useTrackIds();
  const playheadMs = usePlayhead();
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const pxPerSecond = useEditorStore((state) => state.pxPerSecond);

  const scale = useMemo(() => createTimeScale(pxPerSecond), [pxPerSecond]);
  const laneWidth = useMemo(
    () => Math.max(600, scale.timeToPx(timelineDuration(timeline) + TAIL_MS)),
    [scale, timeline],
  );

  // Lint runs once per timeline object, not once per clip. The map fans the
  // single result out to the blocks that need markers.
  const diagnosticsByClip = useMemo(() => {
    const map = new Map<string, ReturnType<typeof lint>>();
    for (const diagnostic of lint(timeline)) {
      for (const clipId of diagnostic.clipIds) {
        const existing = map.get(clipId) ?? [];
        map.set(clipId, [...existing, diagnostic]);
      }
    }
    return map;
  }, [timeline]);

  // Blame, derived from the log like everything else — recomputed only
  // when history moves, so playhead ticks never re-derive it.
  const authors = useMemo(() => authorsByClip(history), [history]);

  // Diff overlay: computed once per overlay object, fanned out per clip
  // and per track for ghosts. Null when no comparison is active.
  const diffOverlay = useVcsStore((state) => state.diffOverlay);
  const diffVisuals = useMemo(
    () => (diffOverlay === null ? null : diffToVisuals(diffOverlay.diff)),
    [diffOverlay],
  );

  const assetDurations = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, asset] of Object.entries(timeline.assets)) {
      out[id] = asset.duration;
    }
    return out;
  }, [timeline]);

  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void uploadFiles(event.dataTransfer.files);
      }}
      style={{
        overflowX: "auto",
        border: "1px solid #2c2e33",
        borderRadius: 6,
        background: "#101114",
        userSelect: "none",
        outline: dragging ? "2px dashed #4dabf7" : "none",
        outlineOffset: -2,
      }}
    >
      <div style={{ position: "relative", width: laneWidth }}>
        <TimeRuler scale={scale} width={laneWidth} />
        {Object.keys(timeline.clips).length === 0 && (
          <div
            style={{
              padding: "36px 12px",
              textAlign: "center",
              color: "#868e96",
              fontSize: 14,
            }}
          >
            <div style={{ marginBottom: 6 }}>Describe your edit, or drop footage here.</div>
            <div style={{ fontSize: 12 }}>
              Upload a video, load the demo clips from the Media tab, or type
              below — every command compiles to engine ops.
            </div>
          </div>
        )}
        {/* Scrub strip first so it paints behind the clips; clip clicks hit
            ClipBlock (which stops propagation), empty-lane clicks land here. */}
        <div
          data-testid="scrub-strip"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setPlayhead(scale.pxToTime(event.clientX - rect.left));
          }}
          data-timeline-lane
          style={{ position: "absolute", inset: 0, cursor: "col-resize" }}
        />
        {trackIds.map((trackId) => (
          <Track
            key={trackId}
            trackId={trackId}
            scale={scale}
            laneWidth={laneWidth}
            assetDurations={assetDurations}
            diagnosticsByClip={diagnosticsByClip}
            authors={authors}
            diffById={diffVisuals?.byId ?? EMPTY_MAP}
            ghosts={diffVisuals?.ghostsByTrack.get(trackId) ?? EMPTY_LIST}
          />
        ))}
        {/* Playhead */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: scale.timeToPx(playheadMs),
            width: 2,
            background: "#ff6b6b",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
