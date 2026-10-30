import {useUiStore} from "../uiStore";
import { useMemo } from "react";
import { diffTimelines, lint } from "@cutroom/engine";
import { currentCommit } from "../lib/vcs";
import { formatTimecode } from "../lib/timecode";
import {
  exportRawProject,
  resetProject,
} from "../lib/persistence/usePersistence";
import { usePersistenceStore } from "../lib/persistence/persistenceStore";
import { useEditorStore, usePlayhead } from "../store";
import { useVcsStore } from "../vcsStore";
import { Button } from "./ui/button";

/**
 * Status bar: branch (or detached commit), dirty state, issue count,
 * timecode, author — and the persistence state, so a storage problem is
 * visible rather than silent.
 */
export function StatusBar() {
  const timeline = useEditorStore((state) => state.timeline);
  const authorId = useEditorStore((state) => state.authorId);
  const pending = useVcsStore((state) => state.pending);
  const mergeRecovery = usePersistenceStore((state) => state.mergeRecovery);
  const repo = useVcsStore((state) => state.repo);
  const playheadMs = usePlayhead();

  const status = usePersistenceStore((state) => state.status);
  const message = usePersistenceStore((state) => state.message);
  const loadFailure = usePersistenceStore((state) => state.loadFailure);
  const usage = usePersistenceStore((state) => state.usage);
  const mediaWarning = usePersistenceStore((state) => state.mediaWarning);

  const dirty = useMemo(() => {
    if (repo === null) return 0;
    try {
      const changes = diffTimelines(currentCommit(repo).timeline, timeline);
      return changes.changes.length + (changes.metadataChanges?.length ?? 0);
    } catch {
      return 0;
    }
  }, [repo, timeline]);

  const issueCount = useMemo(() => lint(timeline).length, [timeline]);
  const detached = repo?.detachedAt ?? null;

  const saveLabel: Record<string, { text: string; className: string }> = {
    idle: { text: "no project saved", className: "text-faint" },
    unsaved: { text: "unsaved", className: "text-warn" },
    saving: { text: "saving…", className: "text-muted" },
    saved: { text: "saved", className: "text-success" },
    unavailable: { text: "storage unavailable — memory only", className: "text-warn" },
    error: { text: "save failed", className: "text-destructive" },
  };
  const save = saveLabel[status] ?? saveLabel.idle!;

  return (
    <>
      {mergeRecovery !== null && <div role="alert" className="merge-recovery">{mergeRecovery}</div>}
      {loadFailure !== null && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-t border-destructive/50 bg-destructive/10 px-3.5 py-1.5 text-[12px]"
        >
          <span className="text-destructive">
            Stored project could not be loaded: {loadFailure.message}
          </span>
          <span className="text-muted">
            Your raw data is kept — export it before resetting.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportRawProject(loadFailure.raw)}
          >
            Export raw data
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              if (window.confirm("Reset the project and discard the stored data?")) {
                void resetProject();
              }
            }}
          >
            Reset project
          </Button>
        </div>
      )}
      {status === "error" && message !== null && <div role="alert" className="merge-recovery">{message}</div>}
      {mediaWarning !== null && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-t border-warn/40 bg-warn/10 px-3.5 py-1.5 text-[12px] text-warn"
        >
          {mediaWarning}
        </div>
      )}
      <footer className="flex shrink-0 items-center gap-4 border-t border-border bg-card px-3.5 py-1 font-mono text-[11px] text-muted">
        {detached !== null ? (
          <span className="text-[#d97757]" title="Detached HEAD — viewing a specific commit">
            ⎇ detached at {detached}
          </span>
        ) : (
          <span title="Current branch">⎇ {repo?.currentBranch ?? "—"}</span>
        )}
        {pending !== null ? <button className="text-warn" onClick={() => useUiStore.getState().openTab("merge")}>Merge pending · {pending.result.conflicts.length} unresolved</button> : dirty > 0 ? (
          <span className="text-warn" title="Uncommitted changes vs the checked-out commit">
            ● {dirty} uncommitted
          </span>
        ) : (
          <span className="text-success" title="Working copy matches the checked-out commit">
            ✓ clean
          </span>
        )}
        <span title="Linter issues">
          {Object.keys(timeline.clips).length === 0 ? "nothing to verify" : `${issueCount} issue${issueCount === 1 ? "" : "s"}`}
        </span>
        <span className={save.className} title={message ?? undefined} data-save-status={status}>
          {save.text}
        </span>
        {usage !== null && usage.quota !== null && usage.usage !== null && (
          <span title="Browser storage used / total">
            {(usage.usage / 1048576).toFixed(0)}/
            {(usage.quota / 1048576).toFixed(0)} MB
          </span>
        )}
        <span className="flex-1" />
        <span className="hidden sm:inline">Ctrl+K commands · S split · Space play</span>
        <span className="tabular-nums text-foreground">{formatTimecode(playheadMs, { fps: timeline.fps ?? 30 })}</span>
        <span title="Local author identity">{authorId}</span>
      </footer>
    </>
  );
}
