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
  onBase,
  onTarget,
}: {
  repo: Repo;
  timeline: Timeline;
  diffBase: string;
  diffTarget: string;
  onBase: (value: string) => void;
  onTarget: (value: string) => void;
}) {
  const store = useVcsStore.getState();
  const openTab = useUiStore((state) => state.openTab);
  const diffOverlay = useVcsStore((state) => state.diffOverlay);
  const { options, resolve } = diffTargets(repo);

  const compare = () => {
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
      <h3 className="vcs-label">Compare versions</h3>
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
      <Button size="sm" onClick={compare}>Compare</Button>
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
  const options: DiffTarget[] = [{ value: "working", label: "Working copy" }];
  const timelines = new Map<string, { timeline: Timeline; label: string }>();
  for (const [name, headId] of Object.entries(repo.branches)) {
    const commit = repo.commits[headId];
    if (commit === undefined) continue;
    options.push({ value: `branch:${name}`, label: `Branch ${name}` });
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
  const [branchName, setBranchName] = useState("");
  const [mergeSource, setMergeSource] = useState("");
  const [diffBase, setDiffBase] = useState("working");
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
  const lintDeltaAgainstParent = useMemo(() => {
    if (repo === null) return null;
    const parentId = currentCommit(repo).parents[0];
    const parent = parentId === undefined ? undefined : repo.commits[parentId];
    if (parent === undefined) return null;
    return lintDelta(parent.timeline, timeline);
  }, [repo, timeline]);

  if (repo === null) {
    return (
      <section style={{ fontSize: 12, color: "#868e96" }}>
        Version control not initialized.
      </section>
    );
  }

  const branches = Object.keys(repo.branches);

  const checkoutGuarded = (name: string) => {
    if (name === repo.currentBranch) return;
    if (
      dirty > 0 &&
      !window.confirm(
        `${dirty} uncommitted change(s) will be left behind (not lost — they stay out of every branch until committed, and switching back won't restore them). Switch anyway?`,
      )
    ) {
      return;
    }
    store.checkoutBranch(name);
  };

  return (
    <section aria-label="version control" className="vcs-panel">
      <header className="vcs-section">
        <h3 className="vcs-label">Current branch</h3>
        {repo.detachedAt !== null ? (
          <div className="vcs-detached">
            detached at {repo.detachedAt}{" "}
            <Button
              size="sm"
              variant="outline"
              onClick={() => store.checkoutBranch(repo.currentBranch)}
            >
              back to {repo.currentBranch}
            </Button>
          </div>
        ) : (
          <select
            aria-label="Current branch"
            value={repo.currentBranch}
            onChange={(event) => checkoutGuarded(event.target.value)}
          >
            {branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        {dirty > 0 && (
          <span className="vcs-summary text-warn">
            {dirty} uncommitted change{dirty === 1 ? "" : "s"}
          </span>
        )}
        <div className="vcs-row">
          <Input
            aria-label="New branch name"
            placeholder="new branch"
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
          />
          <Button
            size="sm"
            onClick={() => {
              try {
                store.createBranch(branchName.trim());
                setBranchName("");
              } catch (error) {
                alert(error instanceof Error ? error.message : "invalid branch");
              }
            }}
          >
            Branch
          </Button>
        </div>
      </header>

      <div className="vcs-section">
        <h3 className="vcs-label">Save a version</h3>
        <div className="vcs-row">
          <Input
            aria-label="Commit message"
            placeholder="commit message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <Button
            size="sm"
            disabled={dirty === 0 || message.trim().length === 0 || repo.detachedAt !== null}
            title={
              repo.detachedAt !== null
                ? "Detached HEAD — check out a branch to commit"
                : undefined
            }
            onClick={() => {
              store.commitCurrent(message.trim());
              setMessage("");
            }}
          >
            Commit
          </Button>
        </div>
      </div>
      {lintDeltaAgainstParent !== null && (
        <div
          className="vcs-summary"
          title="Linter findings introduced or resolved by the uncommitted changes, against the commit they would sit on"
        >
          {lintDeltaAgainstParent.introduced.length === 0 &&
          lintDeltaAgainstParent.resolved.length === 0 ? (
            <span className="text-faint">no change in problems</span>
          ) : (
            <>
              {lintDeltaAgainstParent.introduced.length > 0 && (
                <span className="text-destructive">
                  introduces {lintDeltaAgainstParent.introduced.length} problem
                  {lintDeltaAgainstParent.introduced.length === 1 ? "" : "s"}
                </span>
              )}
              {lintDeltaAgainstParent.introduced.length > 0 &&
                lintDeltaAgainstParent.resolved.length > 0 && " · "}
              {lintDeltaAgainstParent.resolved.length > 0 && (
                <span className="text-success">
                  resolves {lintDeltaAgainstParent.resolved.length} problem
                  {lintDeltaAgainstParent.resolved.length === 1 ? "" : "s"}
                </span>
              )}
            </>
          )}
        </div>
      )}

      <div className="vcs-section">
        <h3 className="vcs-label">History</h3>
        <ul className="vcs-history">
          {history.map((commit) => {
            const viewing = repo.detachedAt === commit.id;
            return (
              <li key={commit.id}>
                <button
                  onClick={() => store.viewCommit(commit.id)}
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
                      <code>{commit.id}</code> · {commit.author}
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
              </li>
            );
          })}
        </ul>
      </div>

      <DiffCompare
        repo={repo}
        timeline={timeline}
        diffBase={diffBase}
        diffTarget={diffTarget}
        onBase={setDiffBase}
        onTarget={setDiffTarget}
      />

      <div className="vcs-section">
        <h3 className="vcs-label">Merge branch</h3>
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
            disabled={mergeSource === ""}
            onClick={() => {
              try {
                store.beginMerge(mergeSource);
                openTab("merge");
              } catch (error) {
                alert(error instanceof Error ? error.message : "merge failed");
              }
            }}
          >
            Merge
          </Button>
        </div>
      </div>
    </section>
  );
}
