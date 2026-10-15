import { useMemo } from "react";
import { diffTimelines } from "@cutroom/engine";
import { head } from "../lib/vcs";
import { useEditorStore, usePlayhead } from "../store";
import { useVcsStore } from "../vcsStore";
import { formatTime } from "../theme";

/** Bottom status line: branch, dirtiness, scale, position. Always honest. */
export function StatusBar() {
  const timeline = useEditorStore((state) => state.timeline);
  const repo = useVcsStore((state) => state.repo);
  const playheadMs = usePlayhead();

  const dirty = useMemo(() => {
    if (repo === null) return 0;
    try {
      return diffTimelines(head(repo).timeline, timeline).changes.length;
    } catch {
      return 0;
    }
  }, [repo, timeline]);

  const clips = Object.keys(timeline.clips).length;

  return (
    <footer className="flex shrink-0 items-center gap-4 border-t border-border bg-card px-3.5 py-1.5 font-mono text-[11px] text-muted">
      <span title="Current branch">⎇ {repo?.currentBranch ?? "—"}</span>
      {dirty > 0 ? (
        <span className="text-warn" title="Uncommitted changes vs branch head">
          ● {dirty} uncommitted
        </span>
      ) : (
        <span className="text-success" title="Working copy matches branch head">✓ clean</span>
      )}
      <span title="Clips on the timeline">
        {clips} clip{clips === 1 ? "" : "s"}
      </span>
      <span className="flex-1" />
      <span className="hidden sm:inline">Ctrl+K commands · S split · Space play</span>
      <span>{formatTime(playheadMs)}</span>
    </footer>
  );
}
