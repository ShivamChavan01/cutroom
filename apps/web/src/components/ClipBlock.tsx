import {
  memo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Clip, Diagnostic } from "@cutroom/engine";
import type { TimeScale } from "../lib/timeScale";
import { authorColor } from "../lib/identity";
import type { DiffTint } from "../lib/diffView";
import { useEditorStore } from "../store";
import { useMediaPosters } from "../lib/media/poster";
import { useAssetUrls } from "../lib/assets";
import { useUiStore } from "../uiStore";

export const DIFF_BORDER: Record<DiffTint, string> = {
  added: "#51cf66",
  removed: "#ff6b6b",
  moved: "#74c0fc",
  trimmed: "#ffd43b",
  edited: "#b197fc",
};

/** Below this a trim is treated as noise, not intent. */
const MIN_DURATION_MS = 50;

interface ClipBlockProps {
  readonly clip: Clip;
  readonly scale: TimeScale;
  readonly assetDurationMs: number | undefined;
  readonly diagnostics: readonly Diagnostic[];
  readonly author: string | undefined;
  /** Diff overlay: tint + text cue. Ghosts render dashed and inert. */
  readonly diffTint?: DiffTint;
  readonly diffBadge?: string;
  readonly ghost?: boolean;
  /** Conflict ghosts: crimson + ⚠, shown instead of the removed-ghost style. */
  readonly ghostVariant?: "conflict";
}

/**
 * One clip on the timeline. Trim handles on both edges: drag updates a
 * local preview only; a single trimClip op dispatches on release, so a
 * 200px drag is one history entry, not two hundred.
 */
export const ClipBlock = memo(function ClipBlock({
  clip,
  scale,
  assetDurationMs,
  diagnostics,
  author,
  diffTint,
  diffBadge,
  ghost = false,
  ghostVariant,
}: ClipBlockProps) {
  const selected = useEditorStore((state) => state.selectedClipId === clip.id);
  const poster = useMediaPosters((posters) => posters.get(clip.assetId));
  const asset = useEditorStore((state) => state.timeline.assets[clip.assetId]);
  const imageUrl = useAssetUrls((urls) => asset?.kind === "image" ? urls.get(clip.assetId) : undefined);
  const locked = useUiStore((state) => state.lockedTrackIds.includes(clip.trackId));
  const [moveDelta, setMoveDelta] = useState(0);
  const [moveError, setMoveError] = useState<string | null>(null);
  const moveRef = useRef<{ x: number; y: number; delta: number; moved: boolean } | null>(null);
  const selectClip = useEditorStore((state) => state.selectClip);
  const dispatch = useEditorStore((state) => state.dispatch);
  const [dragDxMs, setDragDxMs] = useState<number | null>(null);
  const dragSideRef = useRef<"left" | "right" | null>(null);
  const dragStartXRef = useRef(0);

  const hasError = diagnostics.some((d) => d.severity === "error");
  const hasWarning = !hasError && diagnostics.length > 0;

  // Clamp the raw drag delta so the preview — and the eventual op — can
  // never describe an impossible clip. The engine would throw; the UI
  // should make it unreachable instead.
  const clampDx = (side: "left" | "right", dxMs: number): number => {
    if (side === "left") {
      const maxRight = clip.duration - MIN_DURATION_MS;
      const maxLeft = -Math.min(clip.inPoint, clip.start);
      return Math.min(maxRight, Math.max(maxLeft, dxMs));
    }
    const maxDuration =
      assetDurationMs === undefined
        ? Number.MAX_SAFE_INTEGER
        : assetDurationMs - clip.inPoint;
    return Math.min(maxDuration - clip.duration, Math.max(MIN_DURATION_MS - clip.duration, dxMs));
  };

  const beginDrag = (side: "left" | "right", clientX: number) => {
    if (locked) return;
    dragSideRef.current = side;
    dragStartXRef.current = clientX;
    setDragDxMs(0);
  };

  const onHandleMove = (clientX: number) => {
    const side = dragSideRef.current;
    if (side === null) return;
    setDragDxMs(clampDx(side, scale.pxToTime(clientX - dragStartXRef.current)));
  };

  const endDrag = () => {
    const side = dragSideRef.current;
    dragSideRef.current = null;
    if (side !== null && dragDxMs !== null && dragDxMs !== 0) {
      dispatch(
        side === "left"
          ? {
              type: "trimClip",
              clipId: clip.id,
              inPoint: clip.inPoint + dragDxMs,
              duration: clip.duration - dragDxMs,
            }
          : { type: "trimClip", clipId: clip.id, duration: clip.duration + dragDxMs },
      );
    }
    setDragDxMs(null);
  };

  // Preview geometry during a drag; engine geometry otherwise.
  const shownStart =
    dragDxMs !== null && dragSideRef.current === "left"
      ? clip.start + dragDxMs
      : clip.start;
  const shownDuration =
    dragDxMs !== null
      ? dragSideRef.current === "left"
        ? clip.duration - dragDxMs
        : clip.duration + dragDxMs
      : clip.duration;

  const handleStyle = (side: "left" | "right"): CSSProperties => ({
    position: "absolute",
    top: 0,
    bottom: 0,
    [side]: 0,
    width: 8,
    cursor: "ew-resize",
    background: "rgba(255,255,255,0.15)",
    touchAction: "none",
  });

  // Pointer capture retargets move/up to the handle itself, so the handlers
  // live here — not on the parent, which stops receiving them mid-drag.
  const handleProps = (side: "left" | "right") => ({
    style: handleStyle(side),
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (locked) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      beginDrag(side, event.clientX);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragSideRef.current === side) onHandleMove(event.clientX);
    },
    onPointerUp: () => endDrag(),
    onPointerCancel: () => endDrag(),
  });

  const diffBorder =
    diffTint !== undefined ? `2px solid ${DIFF_BORDER[diffTint]}` : undefined;
  const titleLines = [
    ...(author !== undefined ? [`last edited by ${author}`] : []),
    ...(diffBadge !== undefined ? [`diff: ${diffBadge}`] : []),
    ...diagnostics.map((d) => d.message),
  ];

  if (ghost) {
    // Removed clips render at their old position, dashed and inert: no
    // selection, no trim handles, no pointer interaction. Conflict ghosts
    // share that layout but brand themselves as merge candidates.
    const conflict = ghostVariant === "conflict";
    return (
      <div
        aria-label={conflict ? `merge candidate ${clip.id}` : `removed clip ${clip.id}`}
        title={
          conflict
            ? `merge candidate\n${titleLines.join("\n") || clip.id}`
            : titleLines.join("\n") || clip.id
        }
        style={{
          position: "absolute",
          left: scale.timeToPx(clip.start),
          width: Math.max(2, scale.timeToPx(clip.duration)),
          top: 4,
          bottom: 4,
          background: "transparent",
          border: `2px dashed ${conflict ? "#ff8787" : DIFF_BORDER.removed}`,
          borderRadius: 4,
          color: "#ffa8a8",
          fontSize: 11,
          padding: "2px 6px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          boxSizing: "border-box",
          opacity: 0.6,
          pointerEvents: "none",
        }}
      >
        {conflict ? "⚠" : "✕"} {clip.id} {diffBadge !== undefined ? `· ${diffBadge}` : ""}
      </div>
    );
  }

  return (
    <div
      role="button"
      className="studio-clip"
      tabIndex={0}
      aria-label={`clip ${clip.id}`}
      title={titleLines.join("\n") || clip.id}
      onPointerDown={(event) => {
        if (locked || event.button !== 0) return;
        moveRef.current = { x: event.clientX, y: event.clientY, delta: 0, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const moving = moveRef.current;
        if (moving === null) return;
        if (Math.abs(event.clientX - moving.x) > 3 || Math.abs(event.clientY - moving.y) > 8) moving.moved = true;
        if (!moving.moved) return;
        moving.delta = Math.max(-clip.start, Math.round(scale.pxToTime(event.clientX - moving.x)));
        setMoveDelta(moving.delta);
      }}
      onPointerUp={(event) => {
        const moving = moveRef.current;
        moveRef.current = null;
        setMoveDelta(0);
        if (moving === null || !moving.moved) return;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-track-id]")?.dataset.trackId;
        const track = useEditorStore.getState().timeline.tracks.find((item) => item.id === target);
        const compatible = track !== undefined && (asset?.kind === "audio" ? track.kind === "audio" : track.kind === "video");
        try {
          dispatch({ type: "moveClip", clipId: clip.id, start: clip.start + moving.delta, ...(compatible ? { trackId: track.id } : {}) });
          setMoveError(null);
        } catch (reason) { setMoveError(reason instanceof Error ? reason.message : "Could not move clip."); }
      }}
      onPointerCancel={() => { moveRef.current = null; setMoveDelta(0); }}
      onClick={(event) => {
        event.stopPropagation();
        selectClip(clip.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") selectClip(clip.id);
      }}
      style={{
        position: "absolute",
        left: scale.timeToPx(shownStart + moveDelta),
        width: Math.max(2, scale.timeToPx(shownDuration)),
        top: 4,
        bottom: 4,
        background: clip.trackId.startsWith("a") ? "#304a3e" : "#344e56",
        border:
          diffBorder ??
          (selected ? "2px solid var(--color-primary)" : "1px solid #6b8e98"),
        borderBottom: hasError
          ? "3px solid #ff6b6b"
          : hasWarning
            ? "3px solid #ffd43b"
            : undefined,
        borderRadius: 4,
        color: "#fff",
        fontSize: 11,
        padding: "2px 6px",
        overflow: "hidden",
        whiteSpace: "nowrap",
        cursor: "pointer",
        boxSizing: "border-box",
        opacity: dragDxMs !== null ? 0.85 : 1,
      }}
    >
      {(poster ?? imageUrl) !== undefined && !clip.trackId.startsWith("a") && (
        <div className="clip-filmstrip" aria-hidden style={{ backgroundImage: `url("${poster ?? imageUrl}")` }} />
      )}
      <div className="clip-caption">
      {(hasError || hasWarning) && (
        <span style={{ marginRight: 4 }}>{hasError ? "●" : "○"}</span>
      )}
      {author !== undefined && (
        <span
          title={`last edited by ${author}`}
          style={{
            display: "inline-block", width: 7, height: 7,
            borderRadius: "50%", marginRight: 4,
            background: authorColor(author),
          }}
        />
      )}
      {diffBadge !== undefined && (
        <span style={{ marginRight: 4, opacity: 0.9 }}>{diffBadge}</span>
      )}
      {asset?.name ?? clip.id}
      </div>
      {moveError !== null && <span role="alert" className="clip-move-error">{moveError}</span>}
      <div {...handleProps("left")} />
      <div {...handleProps("right")} />
    </div>
  );
});
