import { memo } from "react";
import type { Diagnostic } from "@cutroom/engine";
import type { TimeScale } from "../lib/timeScale";
import { useClipsOnTrack, useEditorStore } from "../store";
import { ClipBlock } from "./ClipBlock";

interface TrackProps {
  readonly trackId: string;
  readonly scale: TimeScale;
  readonly laneWidth: number;
  readonly assetDurations: Readonly<Record<string, number>>;
  readonly diagnosticsByClip: ReadonlyMap<string, readonly Diagnostic[]>;
  readonly authors: ReadonlyMap<string, string>;
}

export const Track = memo(function Track({
  trackId,
  scale,
  laneWidth,
  assetDurations,
  diagnosticsByClip,
  authors,
}: TrackProps) {
  const clips = useClipsOnTrack(trackId);
  const selectClip = useEditorStore((state) => state.selectClip);

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
      <span
        style={{
          position: "sticky",
          left: 4,
          top: 14,
          zIndex: 1,
          fontSize: 10,
          color: "#868e96",
          userSelect: "none",
        }}
      >
        {trackId}
      </span>
      {clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          scale={scale}
          assetDurationMs={assetDurations[clip.assetId]}
          diagnostics={diagnosticsByClip.get(clip.id) ?? []}
          author={authors.get(clip.id)}
        />
      ))}
    </div>
  );
});
