import { useMemo } from "react";
import { authorsByClip, lint, timelineDuration } from "@cutroom/engine";
import { createTimeScale } from "../lib/timeScale";
import { useEditorStore, usePlayhead, useTrackIds } from "../store";
import { Track } from "./Track";

/** Trailing space so the last clip never sits flush against the edge. */
const TAIL_MS = 5_000;

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

  const assetDurations = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, asset] of Object.entries(timeline.assets)) {
      out[id] = asset.duration;
    }
    return out;
  }, [timeline]);

  return (
    <div
      style={{
        overflowX: "auto",
        border: "1px solid #2c2e33",
        borderRadius: 6,
        background: "#101114",
        userSelect: "none",
      }}
    >
      <div style={{ position: "relative", width: laneWidth }}>
        {/* Scrub strip first so it paints behind the clips; clip clicks hit
            ClipBlock (which stops propagation), empty-lane clicks land here. */}
        <div
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setPlayhead(scale.pxToTime(event.clientX - rect.left));
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
