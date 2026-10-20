import { useEffect, useMemo, useState } from "react";
import {
  type Timeline,
  diffTimelines,
} from "@cutroom/engine";
import {
  type Repo,
  branchHistory,
  currentCommit,
  head,
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
    <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
      <span style={{ color: "#868e96" }}>Diff</span>
      <select value={diffBase} onChange={(event) => onBase(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span style={{ color: "#868e96" }}>→</span>
      <select value={diffTarget} onChange={(event) => onTarget(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Button size="sm" onClick={compare}>Compare</Button>
      {diffOverlay !== null && (
        <>
          <span style={{ color: "#868e96" }}>
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
  const pending = useVcsStore((state) => state.pending);
  const diffOverlay = useVcsStore((state) => state.diffOverlay);
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
      return diffTimelines(currentCommit(repo).timeline, timeline).changes.length;
    } catch {
      return 0;
    }
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
    <section
      aria-label="version control"
      style={{
        border: "1px solid #2c2e33", borderRadius: 6, background: "#101114",
        padding: "8px 12px", marginTop: 12, fontSize: 12,
      }}
    >
      <header style={{ color: "#868e96", marginBottom: 6 }}>
        Version control —{" "}
        {repo.detachedAt !== null ? (
          <span style={{ color: "#d97757" }}>
            detached at {repo.detachedAt}{" "}
            <Button
              size="sm"
              variant="outline"
              onClick={() => store.checkoutBranch(repo.currentBranch)}
            >
              back to {repo.currentBranch}
            </Button>
          </span>
        ) : (
          <select
            value={repo.currentBranch}
            onChange={(event) => checkoutGuarded(event.target.value)}
          >
            {branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}{" "}
        {dirty > 0 && (
          <span style={{ color: "#ffd43b" }}>
            ({dirty} uncommitted change{dirty === 1 ? "" : "s"})
          </span>
        )}
        <Input
          placeholder="new branch"
          value={branchName}
          onChange={(event) => setBranchName(event.target.value)}
          style={{ marginLeft: 8, width: 110 }}
        />
        <Button size="sm"
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
      </header>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <Input
          placeholder="commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          style={{ flex: 1 }}
        />
        <Button size="sm"
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

      <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0 }}>
        {history.map((commit) => {
          const viewing = repo.detachedAt === commit.id;
          return (
            <li key={commit.id} style={{ marginBottom: 3 }}>
              <button
                onClick={() => store.viewCommit(commit.id)}
                title={`Check out ${commit.id} and view its timeline`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                  background: viewing ? "#23262c" : "transparent",
                  border: viewing ? "1px solid #2c2e33" : "1px solid transparent",
                  borderRadius: 4,
                  padding: "2px 6px",
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    display: "inline-block", width: 8, height: 8,
                    borderRadius: "50%",
                    background: authorColor(commit.author),
                  }}
                />
                <code>{commit.id}</code>
                <span style={{ color: "#e9ecef" }}>{commit.message}</span>
                <span style={{ color: "#868e96" }}>
                  — {commit.author}
                  {commit.parents.length > 1
                    ? ` (merge of ${commit.parents.join(" + ")})`
                    : ""}
                </span>
                {viewing && (
                  <span style={{ marginLeft: "auto", color: "#d97757" }}>
                    viewing
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <DiffCompare
        repo={repo}
        timeline={timeline}
        diffBase={diffBase}
        diffTarget={diffTarget}
        onBase={setDiffBase}
        onTarget={setDiffTarget}
      />

      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
        <select
          value={mergeSource}
          onChange={(event) => setMergeSource(event.target.value)}
          style={{
            background: "#16181d",
            color: "#e9ecef",
            border: "1px solid #2c2e33",
            borderRadius: 6,
            padding: "4px 6px",
            fontSize: 12,
          }}
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
    </section>
  );
}
