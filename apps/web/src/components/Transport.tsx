import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { timelineDuration } from "@cutroom/engine";
import { formatTimecode, nextCut, previousCut } from "../lib/timecode";
import { useEditorStore, usePlayhead } from "../store";
import { Button } from "./ui/button";

export function Transport() {
  const timeline = useEditorStore((state) => state.timeline);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const playheadMs = usePlayhead();
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const play = useEditorStore((state) => state.play);
  const pause = useEditorStore((state) => state.pause);

  const cuts = Object.values(timeline.clips).map((clip) => ({ start: clip.start }));
  const prev = previousCut(cuts, playheadMs);
  const next = nextCut(cuts, playheadMs);

  const togglePlayback = () => {
    if (isPlaying) {
      pause();
      return;
    }
    if (timelineDuration(timeline) === 0) return;
    if (playheadMs >= timelineDuration(timeline)) setPlayhead(0);
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
        {formatTimecode(playheadMs, { fps: timeline.fps ?? 30 })}
      </span>
    </div>
  );
}
