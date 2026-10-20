import { useCallback, useMemo, useRef, useState } from "react";
import { authorsByClip, lint, timelineDuration } from "@cutroom/engine";
import { diffToVisuals, type ClipVisual } from "../lib/diffView";
import { uploadFiles } from "../lib/upload";
import { createTimeScale } from "../lib/timeScale";
import { formatRulerTime } from "../lib/timecode";
import { canSplitAtPlayhead, deleteSelected, splitAtPlayhead } from "../lib/actions";
import { useEditorStore, usePlayhead, useSelection, useTrackIds } from "../store";
import { useVcsStore } from "../vcsStore";
import { Track } from "./Track";
import { Button } from "./ui/button";
import { Scissors, Trash2, ZoomIn, ZoomOut } from "lucide-react";

/** Trailing space so the last clip never sits flush against the edge. */
const TAIL_MS = 5_000;
const TRACK_HEADER_WIDTH = 56;
const RULER_HEIGHT = 22;

// Stable empty references: passing fresh `{}` / `[]` per render would defeat
// Track's memo on every playhead tick when no diff is active.
const EMPTY_MAP: ReadonlyMap<string, ClipVisual> = new Map();
const EMPTY_LIST: readonly ClipVisual[] = [];

/**
 * The timeline editor: toolbar, ruler, track headers, lanes, playhead.
 *
 * The lane element keeps `data-timeline-lane` so the headed harness still
 * measures the real timeline rather than a stand-in.
 */
export function Timeline() {
  const history = useEditorStore((state) => state.history);
  const timeline = useEditorStore((state) => state.timeline);
  const trackIds = useTrackIds();
  const playheadMs = usePlayhead();
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const pxPerSecond = useEditorStore((state) => state.pxPerSecond);
  const setZoom = useEditorStore((state) => state.setZoom);
  const selection = useSelection();

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
  const laneRef = useRef<HTMLDivElement | null>(null);
  const draggingPlayheadRef = useRef(false);

  /** Time under a client X, measured against the real lane element. */
  const timeAtClientX = useCallback(
    (clientX: number): number => {
      const lane = laneRef.current;
      if (lane === null) return 0;
      const rect = lane.getBoundingClientRect();
      return Math.max(0, scale.pxToTime(clientX - rect.left));
    },
    [scale],
  );

  const onPlayheadPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    draggingPlayheadRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPlayheadPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingPlayheadRef.current) return;
    setPlayhead(timeAtClientX(event.clientX));
  };

  const onPlayheadPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingPlayheadRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const rulerTicks = useMemo(() => {
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((s) => s * scale.pxPerSecond >= 80) ?? 600;
    const ticks: number[] = [];
    const endMs = (laneWidth / scale.pxPerSecond) * 1000;
    for (let ms = 0; ms <= endMs; ms += step * 1000) ticks.push(ms);
    return ticks;
  }, [scale, laneWidth]);

  return (
    <div
      className="flex flex-col rounded-md border border-border bg-card"
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
      style={{ outline: dragging ? "2px dashed #d97757" : "none", outlineOffset: -2 }}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={splitAtPlayhead}
          disabled={!canSplitAtPlayhead()}
          title="Split at playhead (S)"
        >
          <Scissors /> Split
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={deleteSelected}
          disabled={selection === null}
          title="Delete selected (Del)"
        >
          <Trash2 /> Delete
        </Button>
        <span className="flex-1" />
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setZoom(pxPerSecond / 1.5)}
          title="Zoom out"
          aria-label="zoom out"
        >
          <ZoomOut />
        </Button>
        <span className="font-mono text-[11px] text-muted">{pxPerSecond}px/s</span>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setZoom(pxPerSecond * 1.5)}
          title="Zoom in"
          aria-label="zoom in"
        >
          <ZoomIn />
        </Button>
      </div>

      <div className="flex min-h-0">
        {/* Track headers */}
        <div
          className="shrink-0 border-r border-border bg-card"
          style={{ width: TRACK_HEADER_WIDTH }}
        >
          <div style={{ height: RULER_HEIGHT }} />
          {trackIds.map((trackId) => (
            <div
              key={trackId}
              className="flex items-center border-b border-border px-2 font-mono text-[11px] text-muted"
              style={{ height: 44 }}
            >
              {trackId}
            </div>
          ))}
        </div>

        {/* Lanes */}
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ position: "relative", width: laneWidth }}>
            {/* Ruler */}
            <div
              className="relative border-b border-border"
              style={{ height: RULER_HEIGHT }}
            >
              {rulerTicks.map((ms) => (
                <div
                  key={ms}
                  className="absolute top-0 h-full border-l border-[#343a40] pl-1 font-mono text-[10px] leading-[22px] text-muted"
                  style={{ left: scale.timeToPx(ms) }}
                >
                  {formatRulerTime(ms)}
                </div>
              ))}
            </div>

            {Object.keys(timeline.clips).length === 0 && (
              // Absolute so it overlays the lanes instead of pushing them
              // down — the track headers would stop lining up.
              <div
                className="pointer-events-none absolute inset-x-0 top-8 z-10 px-3 text-center text-[13px] text-muted"
              >
                <div className="mb-1.5">Drop footage here to begin.</div>
                <div className="text-xs">
                  Upload a video, then split, trim and arrange it on the timeline.
                </div>
              </div>
            )}

            {/* Scrub strip first so it paints behind the clips; clip clicks
                hit ClipBlock (which stops propagation), empty-lane clicks
                land here. */}
            <div
              ref={laneRef}
              data-testid="scrub-strip"
              data-timeline-lane
              onClick={(event) => {
                setPlayhead(timeAtClientX(event.clientX));
              }}
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

            {/* Playhead with a draggable handle */}
            <div
              role="slider"
              tabIndex={0}
              aria-label="playhead"
              aria-valuemin={0}
              aria-valuenow={Math.round(playheadMs)}
              aria-valuetext={formatRulerTime(playheadMs)}
              onPointerDown={onPlayheadPointerDown}
              onPointerMove={onPlayheadPointerMove}
              onPointerUp={onPlayheadPointerUp}
              onPointerCancel={onPlayheadPointerUp}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 1_000 : 100;
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setPlayhead(playheadMs - step);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setPlayhead(playheadMs + step);
                }
              }}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: scale.timeToPx(playheadMs),
                width: 2,
                background: "#d97757",
                cursor: "ew-resize",
                touchAction: "none",
                zIndex: 20,
              }}
            >
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  left: -5,
                  width: 12,
                  height: 12,
                  borderRadius: "0 0 3px 3px",
                  background: "#d97757",
                  clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
