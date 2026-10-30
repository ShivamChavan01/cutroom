import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authorsByClip, lint, detachedAudioId } from "@cutroom/engine";
import { planAudioDetach } from "../lib/detachAudio";
import { indexedTimelineDuration } from "../lib/clipIndex";
import { diffToVisuals, type ClipVisual } from "../lib/diffView";
import {
  conflictsToVisuals,
  type ConflictBand,
  type ConflictGhost,
} from "../lib/mergeView";
import { importMedia } from "../lib/upload";
import { createTimeScale } from "../lib/timeScale";
import { rulerTicksInTimelineWindow, timelineWindow } from "../lib/timelineViewport";
import { formatRulerTime } from "../lib/timecode";
import { canSplitAtPlayhead, deleteSelected, splitAtPlayhead } from "../lib/actions";
import { useEditorStore, usePlayhead, useSelection, useTrackIds } from "../store";
import { useVcsStore } from "../vcsStore";
import { useUiStore } from "../uiStore";
import { Track } from "./Track";
import { Button } from "./ui/button";
import { Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, MessageSquare, Scissors, Trash2, ZoomIn, ZoomOut, Crop, Plus } from "lucide-react";

/** Trailing space so the last clip never sits flush against the edge. */
const TAIL_MS = 5_000;
const TRACK_HEADER_WIDTH = 154;
const RULER_HEIGHT = 22;

// Stable empty references: passing fresh `{}` / `[]` per render would defeat
// Track's memo on every playhead tick when no diff is active.
const EMPTY_MAP: ReadonlyMap<string, ClipVisual> = new Map();
const EMPTY_LIST: readonly ClipVisual[] = [];
const EMPTY_BANDS: readonly ConflictBand[] = [];
const EMPTY_GHOSTS: readonly ConflictGhost[] = [];

function clipIdAtTarget(target: EventTarget | null): string | null {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-clip-id]")?.dataset.clipId ?? null
    : null;
}

function conflictKeyAtTarget(target: EventTarget | null): string | null {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-conflict-key]")?.dataset.conflictKey ?? null
    : null;
}

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
  const lockedTracks = useUiStore((state) => state.lockedTrackIds);
  const hiddenTracks = useUiStore((state) => state.hiddenTrackIds);
  const mutedTracks = useUiStore((state) => state.mutedTrackIds);
  const setInspectorTab = useUiStore((state) => state.setInspectorTab);
  const selectedLocked = selection !== null && lockedTracks.includes(timeline.clips[selection]?.trackId ?? "");

  const [audioNotice, setAudioNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const detachPlan = useMemo(() => planAudioDetach(timeline, selection, lockedTracks), [timeline, selection, lockedTracks]);

  const scale = useMemo(() => createTimeScale(pxPerSecond), [pxPerSecond]);
  const laneWidth = useMemo(
    () => Math.max(600, scale.timeToPx(indexedTimelineDuration(timeline) + TAIL_MS)),
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
  const authors = useMemo(() => authorsByClip(history, timeline), [history, timeline]);

  // Diff overlay: computed once per overlay object, fanned out per clip
  // and per track for ghosts. Null when no comparison is active.
  const diffOverlay = useVcsStore((state) => state.diffOverlay);
  const diffVisuals = useMemo(
    () => (diffOverlay === null ? null : diffToVisuals(diffOverlay.diff)),
    [diffOverlay],
  );

  // Pending merge: bands over each clash and ghosts for the merge's
  // own candidates. Null when no conflicted merge is in flight.
  const pending = useVcsStore((state) => state.pending);
  const resolveConflict = useVcsStore((state) => state.resolveConflict);
  const openTab = useUiStore((state) => state.openTab);
  const conflictVisuals = useMemo(
    () => (pending === null ? null : conflictsToVisuals(pending.result, timeline)),
    [pending, timeline],
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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 1_200 });
  const [pointerClipId, setPointerClipId] = useState<string | null>(null);
  const [focusedClipId, setFocusedClipId] = useState<string | null>(null);
  const [focusedConflictKey, setFocusedConflictKey] = useState<string | null>(null);
  const draggingPlayheadRef = useRef(false);
  const pinnedClipIds = useMemo(
    () => [selection, pointerClipId, focusedClipId],
    [selection, pointerClipId, focusedClipId],
  );
  const visibleWindow = useMemo(
    () => timelineWindow({ scrollLeft: viewport.left, width: viewport.width, scale }),
    [viewport, scale],
  );
  const isEmpty = useMemo(() => Object.keys(timeline.clips).length === 0, [timeline.clips]);

  const measureViewport = useCallback(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const left = element.scrollLeft;
    const width = element.clientWidth;
    setViewport((previous) => previous.left === left && previous.width === width
      ? previous
      : { left, width });
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    measureViewport();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureViewport);
      return () => window.removeEventListener("resize", measureViewport);
    }
    const observer = new ResizeObserver(measureViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureViewport]);

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

  const rulerTicks = useMemo(
    () => rulerTicksInTimelineWindow(visibleWindow, scale, laneWidth),
    [visibleWindow, scale, laneWidth],
  );

  return (
    <div
      className="studio-timeline flex flex-col"
      onPointerDownCapture={(event) => setPointerClipId(clipIdAtTarget(event.target))}
      onPointerUp={() => setPointerClipId(null)}
      onPointerCancel={() => setPointerClipId(null)}
      onLostPointerCapture={() => setPointerClipId(null)}
      onFocusCapture={(event) => {
        setFocusedClipId(clipIdAtTarget(event.target));
        setFocusedConflictKey(conflictKeyAtTarget(event.target));
      }}
      onBlurCapture={(event) => {
        setFocusedClipId(clipIdAtTarget(event.relatedTarget));
        setFocusedConflictKey(conflictKeyAtTarget(event.relatedTarget));
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void importMedia(event.dataTransfer.files);
      }}
      style={{ outline: dragging ? "2px dashed #d97757" : "none", outlineOffset: -2 }}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <span className="sequence-label">Sequence 01</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={splitAtPlayhead}
          disabled={!canSplitAtPlayhead()}
          title="Split at playhead (S)"
        >
          <Scissors /> Split
        </Button>
        <Button size="sm" variant="ghost" disabled={selection === null || selectedLocked} onClick={() => {
          setInspectorTab("clip");
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="In point seconds"]')?.focus());
        }}><Crop /> Trim</Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={deleteSelected}
          disabled={selection === null || selectedLocked}
          title="Delete selected (Del)"
        >
          <Trash2 /> Delete
        </Button>
        <Button size="sm" variant="ghost" disabled={detachPlan.kind === "unavailable"}
          title={detachPlan.kind === "unavailable" ? detachPlan.reason : `Move sound to ${detachPlan.trackName}; video audio becomes silent`}
          onClick={() => {
            try {
              const editor = useEditorStore.getState();
              const plan = planAudioDetach(editor.timeline, editor.selectedClipId, useUiStore.getState().lockedTrackIds);
              if (plan.kind === "unavailable") throw new Error(plan.reason);
              editor.dispatch(plan.op);
              editor.selectClip(detachedAudioId(plan.op.clipId));
              setAudioNotice({ kind: "success", message: `Detached audio to ${plan.trackName} as one undoable edit.` });
            } catch (cause) {
              setAudioNotice({ kind: "error", message: cause instanceof Error ? cause.message : "Could not detach audio." });
            }
          }}><Volume2 /> Detach audio</Button>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" title="Add video track" onClick={() => {
          const number = Math.max(0, ...timeline.tracks.filter((track) => track.kind === "video").map((track) => Number(track.id.slice(1)))) + 1;
          useEditorStore.getState().dispatch({ type: "addTrack", track: { id: `v${number}`, name: `Video ${number}`, kind: "video", muted: false } });
        }}><Plus /> Track</Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setZoom(pxPerSecond / 1.5)}
          title="Zoom out"
          aria-label="zoom out"
        >
          <ZoomOut />
        </Button>
        <input className="timeline-zoom" type="range" aria-label="Timeline zoom" min="5" max="400" step="1" value={pxPerSecond} onChange={(event) => setZoom(Number(event.target.value))} />
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setZoom(pxPerSecond * 1.5)}
          title="Zoom in"
          aria-label="zoom in"
        >
          <ZoomIn />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => {
          const width = viewportRef.current?.clientWidth ?? 800;
          setZoom((width - 30) / Math.max(1, indexedTimelineDuration(timeline) / 1000));
        }}>Fit timeline</Button>
      </div>

      {/* Pending merge banner: skipped entirely while the merge is clean. */}
      {pending !== null && !pending.result.clean && (
        <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-[11px] text-muted">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
          <span>
            Merging{" "}
            <strong className="text-foreground">{pending.sourceBranch}</strong> —{" "}
            {pending.result.conflicts.length} conflict(s) left, resolve on the timeline
          </span>
          <button
            type="button"
            onClick={() => openTab("merge")}
            title="Open the merge conflict list"
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:border-primary hover:text-foreground"
          >
            <MessageSquare size={12} /> Open merge view
          </button>
        </div>
      )}

      {audioNotice !== null && <div role={audioNotice.kind === "error" ? "alert" : "status"} className="flex items-center gap-2 border-b border-border px-3 py-1 text-[11px] text-muted">
        <span className={audioNotice.kind === "error" ? "text-destructive" : undefined}>{audioNotice.message}</span>
        <button type="button" className="ml-auto" aria-label="Dismiss audio message" onClick={() => setAudioNotice(null)}>Dismiss</button>
      </div>}

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
              style={{ height: "var(--timeline-track-height, 64px)" }}
            >
              <div className="track-header-content"><span className="track-name">{timeline.tracks.find((track) => track.id === trackId)?.name ?? trackId.toUpperCase()}</span><div className="track-controls">
                <button type="button" aria-label={`Hide track ${trackId}`} aria-pressed={hiddenTracks.includes(trackId)} onClick={() => useUiStore.getState().toggleTrackHidden(trackId)}>{hiddenTracks.includes(trackId) ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                <button type="button" aria-label={`Mute track ${trackId}`} aria-pressed={mutedTracks.includes(trackId)} onClick={() => useUiStore.getState().toggleTrackMuted(trackId)}>{mutedTracks.includes(trackId) ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
                <button type="button" aria-label={`Lock track ${trackId}`} aria-pressed={lockedTracks.includes(trackId)} onClick={() => useUiStore.getState().toggleTrackLocked(trackId)}>{lockedTracks.includes(trackId) ? <Lock size={13} /> : <Unlock size={13} />}</button>
              </div></div>
            </div>
          ))}
        </div>

        {/* Lanes */}
        <div ref={viewportRef} onScroll={measureViewport} className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ position: "relative", width: laneWidth }}>
            {/* Ruler */}
            <div
              className="relative border-b border-border"
              style={{ height: RULER_HEIGHT }}
            >
              {rulerTicks.map((ms) => (
                <div
                  key={ms}
                  className="absolute top-0 h-full border-l border-border pl-1 font-mono text-[10px] leading-[22px] text-muted"
                  style={{ left: scale.timeToPx(ms) }}
                >
                  {formatRulerTime(ms)}
                </div>
              ))}
            </div>

            {isEmpty && (
              // Absolute so it overlays the lanes instead of pushing them
              // down — the track headers would stop lining up.
              <div
                className="pointer-events-none absolute inset-x-0 top-8 z-10 px-3 text-center text-[13px] text-muted"
              >
                <div className="mb-1.5">Your sequence starts here.</div>
                <div className="text-xs">
                  Video and audio clips appear on these tracks.
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
                visibleWindow={visibleWindow}
                pinnedClipIds={pinnedClipIds}
                focusedConflictKey={focusedConflictKey}
                assetDurations={assetDurations}
                diagnosticsByClip={diagnosticsByClip}
                authors={authors}
                diffById={diffVisuals?.byId ?? EMPTY_MAP}
                ghosts={diffVisuals?.ghostsByTrack.get(trackId) ?? EMPTY_LIST}
                conflictBands={
                  conflictVisuals?.bandsByTrack.get(trackId) ?? EMPTY_BANDS
                }
                conflictGhosts={
                  conflictVisuals?.ghostsByTrack.get(trackId) ?? EMPTY_GHOSTS
                }
                mergeResult={pending === null ? null : pending.result}
                resolveConflict={resolveConflict}
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
                background: "var(--color-primary)",
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
                  background: "var(--color-primary)",
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
