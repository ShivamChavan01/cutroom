import { useEffect, useMemo, useState } from "react";
import {
  type Timeline,
  diffTimelines,
  lintDelta,
} from "@cutroom/engine";
import {
  type Repo,
  branchHistory,
  currentCommit,
} from "../lib/vcs";
import { authorColor } from "../lib/identity";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";
import { useVcsStore } from "../vcsStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function DiffCompare({
  repo,
  timeline,
  diffBase,
  diffTarget,
  workingCommit,
  onBase,
  onTarget,
}: {
  repo: Repo;
  timeline: Timeline;
  diffBase: string;
  diffTarget: string;
  workingCommit: string | null;
  onBase: (value: string) => void;
  onTarget: (value: string) => void;
}) {
  const store = useVcsStore.getState();
  const openTab = useUiStore((state) => state.openTab);
  const diffOverlay = useVcsStore((state) => state.diffOverlay);
  const { options, resolve } = diffTargets(repo);

  const snapshotId = (value: string) => value === "working" ? workingCommit
    : value.startsWith("branch:") ? repo.branches[value.slice(7)] : value.slice(7);
  const sameVersion = diffBase === diffTarget || snapshotId(diffBase) === snapshotId(diffTarget);
  const compare = () => {
    if (sameVersion) return;
    const base =
      diffBase === "working"
        ? { timeline, label: "working copy" }
        : resolve(diffBase);
    const target =
      diffTarget === "working"
        ? { timeline, label: "working copy" }
        : resolve(diffTarget);
    if (base === null || target === null) return;
    store.setDiff(base.timeline, base.label, target.timeline, target.label);
    openTab("diff");
  };

  return (
    <div className="vcs-section vcs-compare">
      <label className="vcs-field">
        <span className="vcs-label">From</span>
        <select
          aria-label="Compare from"
          value={diffBase}
          onChange={(event) => onBase(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="vcs-field">
        <span className="vcs-label">To</span>
        <select
          aria-label="Compare to"
          value={diffTarget}
          onChange={(event) => onTarget(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <Button size="sm" onClick={compare} disabled={sameVersion}>Compare</Button>
      {diffOverlay !== null && (
        <>
          <span className="vcs-summary">
            {diffOverlay.baseLabel} → {diffOverlay.targetLabel}:{" "}
            {diffOverlay.diff.added} added, {diffOverlay.diff.removed} removed,{" "}
            {diffOverlay.diff.changed} changed
          </span>
          <Button size="sm" onClick={store.clearDiff}>Clear</Button>
        </>
      )}
    </div>
  );
}

/**
 * Git for video, first face: branches, commits, merge with explicit
 * conflict resolution. Every resolution is a side-pick or a removal —
 * the UI cannot invent timeline content the engine didn't produce.
 */
/**
 * Anything diffable: the working copy, a branch head, or any commit.
 * Values encode as `kind:id` so the select stays a plain string.
 */
type DiffTarget = { readonly value: string; readonly label: string };

function diffTargets(
  repo: Repo,
): { readonly options: readonly DiffTarget[]; readonly resolve: (value: string) => { timeline: Timeline; label: string } | null } {
  const options: DiffTarget[] = [{ value: "working", label: "Current edit" }];
  const timelines = new Map<string, { timeline: Timeline; label: string }>();
  for (const [name, headId] of Object.entries(repo.branches)) {
    const commit = repo.commits[headId];
    if (commit === undefined) continue;
    options.push({ value: `branch:${name}`, label: `Cut · ${name}` });
    timelines.set(`branch:${name}`, { timeline: commit.timeline, label: `branch ${name}` });
  }
  const seen = new Set<string>();
  for (const commit of Object.values(repo.commits)) {
    if (seen.has(commit.id)) continue;
    seen.add(commit.id);
    options.push({ value: `commit:${commit.id}`, label: `${commit.id} ${commit.message}` });
    timelines.set(`commit:${commit.id}`, { timeline: commit.timeline, label: `commit ${commit.id}` });
  }
  return {
    options,
    resolve: (value) => timelines.get(value) ?? null,
  };
}

export function VersionControl() {
  const repo = useVcsStore((state) => state.repo);
  const openTab = useUiStore((state) => state.openTab);
  const timeline = useEditorStore((state) => state.timeline);
  const [message, setMessage] = useState("");
  const [mergeSource, setMergeSource] = useState("");
  const [mergeFeedback, setMergeFeedback] = useState<{repo: Repo; message: string} | null>(null);
  const [diffBase, setDiffBase] = useState("");
  const [diffTarget, setDiffTarget] = useState("working");

  const store = useVcsStore.getState();
  useEffect(() => {
    store.ensureRepo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const history = useMemo(
    () => (repo === null ? [] : branchHistory(repo)),
    [repo],
  );
  const dirty = useMemo(() => {
    if (repo === null) return 0;
    try {
      // Compare against whatever is checked out: the branch tip normally,
      // the viewed commit while detached.
      const changes = diffTimelines(currentCommit(repo).timeline, timeline);
      return changes.changes.length + (changes.metadataChanges?.length ?? 0);
    } catch {
      return 0;
    }
  }, [repo, timeline]);

  /**
   * What the working copy does to the linter's findings, measured against
   * the commit this one would sit on top of.
   */
  const workingLintDelta = useMemo(() => {
    if (repo === null) return null;
    if (dirty === 0) return null;
    return lintDelta(currentCommit(repo).timeline, timeline);
  }, [repo, timeline, dirty]);

  if (repo === null) {
    return (
      <section style={{ fontSize: 12, color: "#868e96" }}>
        Version control not initialized.
      </section>
    );
  }

  const branches = Object.keys(repo.branches);

  const current = currentCommit(repo);
  const suggestedBase = dirty > 0 ? current.id : current.parents[0] ?? current.id;
  const base = diffBase || `commit:${suggestedBase}`;

  return (
    <section aria-label="version control" className="vcs-panel">
      {repo.detachedAt !== null && <div className="vcs-detached">
        <p>Viewing saved version “{current.message}”</p>
        <Button size="sm" onClick={() => {
          try { store.checkoutBranch(repo.currentBranch); }
          catch (error) { window.alert(error instanceof Error ? error.message : "Could not return to the cut"); }
        }}>Return to {repo.currentBranch}</Button>
      </div>}
      {dirty > 0 ? <div className="vcs-section save-version">
        <strong className="vcs-summary text-warn">{dirty} change{dirty === 1 ? "" : "s"} since the last save</strong>
        {repo.detachedAt === null ? <form onSubmit={event => {
          event.preventDefault();
          if (!message.trim()) return;
          try { store.commitCurrent(message.trim()); setMessage(""); }
          catch (error) { window.alert(error instanceof Error ? error.message : "Could not save version"); }
        }}>
          <label className="vcs-field">What changed?
            <Input placeholder="Describe your edit" value={message} onChange={event => setMessage(event.target.value)} />
          </label>
          <Button size="sm" variant="default" disabled={!message.trim()}>Save version</Button>
        </form> : <p>Create another cut to save edits to this version.</p>}
      </div> : repo.detachedAt === null && <p className="cut-save-state">All changes saved · Latest save: {current.message}</p>}
      {workingLintDelta !== null && (workingLintDelta.introduced.length > 0 || workingLintDelta.resolved.length > 0) && (
        <div className="vcs-summary" title="Issue changes since the last saved version">
          {workingLintDelta.introduced.length > 0 && (
            <span className="text-destructive">
              introduces {workingLintDelta.introduced.length} problem
              {workingLintDelta.introduced.length === 1 ? "" : "s"}
            </span>
          )}
          {workingLintDelta.introduced.length > 0 &&
            workingLintDelta.resolved.length > 0 && " · "}
          {workingLintDelta.resolved.length > 0 && (
            <span className="text-success">
              resolves {workingLintDelta.resolved.length} problem
              {workingLintDelta.resolved.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      <div className="vcs-section">
        <h3 className="cut-history-title">Saved versions</h3>
        <ul className="vcs-history">
          {history.map((commit) => {
            const viewing = repo.detachedAt === commit.id;
            return (
              <li key={commit.id}>
                <button
                  onClick={() => { try { store.viewCommit(commit.id); } catch (error) { window.alert(error instanceof Error ? error.message : "Checkout failed"); } }}
                  title={`Check out ${commit.id} and view its timeline`}
                  className={`vcs-commit${viewing ? " vcs-commit-viewing" : ""}`}
                >
                  <span
                    className="vcs-author-dot"
                    style={{ background: authorColor(commit.author) }}
                  />
                  <span className="vcs-commit-copy">
                    <span className="vcs-commit-title" title={commit.message}>{commit.message}</span>
                    <span className="vcs-commit-meta">
                      {commit.author} · <time>{new Date(commit.at).toLocaleString(undefined, {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"})}</time>
                      {commit.parents.length > 1
                        ? ` (merge of ${commit.parents.join(" + ")})`
                        : ""}
                    </span>
                  </span>
                  {viewing && (
                    <span className="vcs-viewing-label">
                      viewing
                    </span>
                  )}
                </button>
                <Button size="sm" variant="ghost" aria-label={`Compare ${commit.message} with current edit`}
                  disabled={dirty === 0 && current.id === commit.id}
                  onClick={() => {
                    setDiffBase(`commit:${commit.id}`); setDiffTarget("working");
                    store.setDiff(commit.timeline, commit.message, timeline, "Current edit");
                    openTab("diff");
                  }}>Compare</Button>
              </li>
            );
          })}
        </ul>
      </div>

      <details className="cut-tools"><summary>Compare other versions</summary>
      <DiffCompare
        repo={repo}
        timeline={timeline}
        diffBase={base}
        workingCommit={dirty === 0 ? current.id : null}
        diffTarget={diffTarget}
        onBase={setDiffBase}
        onTarget={setDiffTarget}
      />

      </details>
      <details className="cut-tools"><summary>Combine cuts</summary><div className="vcs-section">
        <span>Bring changes into {repo.currentBranch}</span>
        {dirty === 0 && mergeFeedback?.repo === repo && <p role="status" className="vcs-summary">{mergeFeedback.message}</p>}
        <div className="vcs-row">
          <select
            aria-label="Merge source"
            value={mergeSource}
            onChange={(event) => setMergeSource(event.target.value)}
          >
            <option value="">merge from…</option>
            {branches
              .filter((name) => name !== repo.currentBranch)
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
          <Button
            size="sm"
            disabled={!mergeSource || !branches.includes(mergeSource) || mergeSource === repo.currentBranch || repo.detachedAt !== null}
            onClick={() => {
              try {
                setMergeFeedback(null);
                const outcome = store.beginMerge(mergeSource);
                if (outcome === "pending") openTab("merge");
                else {
                  openTab("timeline");
                  const current = useVcsStore.getState().repo;
                  if (current !== null) setMergeFeedback({repo: current, message: outcome === "up-to-date" ? "Already up to date. No new edits to combine." : `Fast-forwarded ${current.currentBranch} to ${current.branches[current.currentBranch]}. No extra commit was created.`});
                }
              } catch (error) {
                alert(error instanceof Error ? error.message : "merge failed");
              }
            }}
          >
            Merge
          </Button>
        </div>
      </div></details>
    </section>
  );
}
