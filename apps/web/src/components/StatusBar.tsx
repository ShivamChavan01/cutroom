import { useMemo } from "react";
import { diffTimelines, lint } from "@cutroom/engine";
import { currentCommit } from "../lib/vcs";
import { formatTimecode } from "../lib/timecode";
import { useEditorStore, usePlayhead } from "../store";
import { useVcsStore } from "../vcsStore";

/**
 * Status bar: branch (or detached commit), dirty state, issue count,
 * timecode and author. Every value is derived from real state.
 */
export function StatusBar() {
  const timeline = useEditorStore((state) => state.timeline);
  const authorId = useEditorStore((state) => state.authorId);
  const repo = useVcsStore((state) => state.repo);
  const playheadMs = usePlayhead();

  const dirty = useMemo(() => {
    if (repo === null) return 0;
    try {
      return diffTimelines(currentCommit(repo).timeline, timeline).changes.length;
    } catch {
      return 0;
    }
  }, [repo, timeline]);

  const issueCount = useMemo(() => lint(timeline).length, [timeline]);
  const detached = repo?.detachedAt ?? null;

  return (
    <footer className="flex shrink-0 items-center gap-4 border-t border-border bg-card px-3.5 py-1 font-mono text-[11px] text-muted">
      {detached !== null ? (
        <span className="text-[#d97757]" title="Detached HEAD — viewing a specific commit">
          ⎇ detached at {detached}
        </span>
      ) : (
        <span title="Current branch">⎇ {repo?.currentBranch ?? "—"}</span>
      )}
      {dirty > 0 ? (
        <span className="text-warn" title="Uncommitted changes vs the checked-out commit">
          ● {dirty} uncommitted
        </span>
      ) : (
        <span className="text-success" title="Working copy matches the checked-out commit">
          ✓ clean
        </span>
      )}
      <span title="Linter issues">
        {issueCount} issue{issueCount === 1 ? "" : "s"}
      </span>
      <span className="flex-1" />
      <span className="hidden sm:inline">Ctrl+K commands · S split · Space play</span>
      <span className="tabular-nums text-foreground">{formatTimecode(playheadMs)}</span>
      <span title="Local author identity">{authorId}</span>
    </footer>
  );
}
