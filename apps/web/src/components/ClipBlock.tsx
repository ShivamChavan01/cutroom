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
}: ClipBlockProps) {
  const selected = useEditorStore((state) => state.selectedClipId === clip.id);
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
    // selection, no trim handles, no pointer interaction.
    return (
      <div
        aria-label={`removed clip ${clip.id}`}
        title={titleLines.join("\n") || clip.id}
        style={{
          position: "absolute",
          left: scale.timeToPx(clip.start),
          width: Math.max(2, scale.timeToPx(clip.duration)),
          top: 4,
          bottom: 4,
          background: "transparent",
          border: `2px dashed ${DIFF_BORDER.removed}`,
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
        ✕ {clip.id} {diffBadge !== undefined ? `· ${diffBadge}` : ""}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`clip ${clip.id}`}
      title={titleLines.join("\n") || clip.id}
      onClick={(event) => {
        event.stopPropagation();
        selectClip(clip.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") selectClip(clip.id);
      }}
      style={{
        position: "absolute",
        left: scale.timeToPx(shownStart),
        width: Math.max(2, scale.timeToPx(shownDuration)),
        top: 4,
        bottom: 4,
        background: clip.trackId.startsWith("a") ? "#2f6f4f" : "#3b5bdb",
        border:
          diffBorder ??
          (selected ? "2px solid #ffd43b" : "1px solid rgba(255,255,255,0.25)"),
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
      {clip.id}
      <div {...handleProps("left")} />
      <div {...handleProps("right")} />
    </div>
  );
});
