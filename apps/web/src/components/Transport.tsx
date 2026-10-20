import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { type Clip, clipsOnTrack, timelineDuration } from "@cutroom/engine";
import { formatTimecode, nextCut, previousCut } from "../lib/timecode";
import { useEditorStore, usePlayhead } from "../store";
import { Button } from "./ui/button";

function firstVideoTrackId(timeline: {
  tracks: readonly { id: string; kind: string }[];
}): string {
  return timeline.tracks.find((track) => track.kind === "video")?.id ?? "v1";
}

/**
 * Transport: play/pause and jump between cuts, with a timecode readout.
 * Cut navigation works on the video track's clip starts — real edits, not
 * decoration: pressing next lands exactly on the next cut.
 */
export function Transport() {
  const timeline = useEditorStore((state) => state.timeline);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const playheadMs = usePlayhead();
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const play = useEditorStore((state) => state.play);
  const pause = useEditorStore((state) => state.pause);

  const clips: readonly Clip[] = clipsOnTrack(timeline, firstVideoTrackId(timeline));
  const cuts = clips.map((clip) => ({ start: clip.start }));
  const prev = previousCut(cuts, playheadMs);
  const next = nextCut(cuts, playheadMs);

  /**
   * Play from the playhead. Pressing play past the end of the timeline
   * restarts from zero — the same behaviour the player had when it owned
   * the button.
   */
  const togglePlayback = () => {
    if (isPlaying) {
      pause();
      return;
    }
    let at = playheadMs;
    const underPlayhead = clips.some(
      (clip) => at >= clip.start && at < clip.start + clip.duration,
    );
    if (!underPlayhead) {
      if (at < timelineDuration(timeline)) return; // in a gap: stay put
      at = 0;
      setPlayhead(0);
    }
    play();
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => prev !== null && setPlayhead(prev)}
        disabled={prev === null}
        title="Previous cut"
        aria-label="previous cut"
      >
        <SkipBack />
      </Button>
      <Button
        size="icon"
        variant="default"
        onClick={togglePlayback}
        title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        aria-label={isPlaying ? "pause" : "play"}
      >
        {isPlaying ? <Pause /> : <Play />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => next !== null && setPlayhead(next)}
        disabled={next === null}
        title="Next cut"
        aria-label="next cut"
      >
        <SkipForward />
      </Button>
      <span
        className="ml-2 font-mono text-sm tabular-nums text-foreground"
        aria-label="timecode"
      >
        {formatTimecode(playheadMs)}
      </span>
    </div>
  );
}
