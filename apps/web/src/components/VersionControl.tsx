import { useEffect, useMemo, useState } from "react";
import {
  type MergeResult,
  diffTimelines,
  resolveField,
} from "@cutroom/engine";
import { branchHistory, head, resolveDeleteModify, resolveOverlap } from "../lib/vcs";
import { authorColor } from "../lib/identity";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";

function ConflictRow({
  conflict,
  result,
  onResolve,
}: {
  conflict: MergeResult["conflicts"][number];
  result: MergeResult;
  onResolve: (next: MergeResult) => void;
}) {
  if (conflict.kind === "field") {
    return (
      <li style={{ marginBottom: 6 }}>
        <span style={{ color: "#ffd43b" }}>[field]</span> {conflict.clipId}.
        {conflict.field}: ours {String(conflict.ours)} vs theirs{" "}
        {String(conflict.theirs)}{" "}
        <button
          onClick={() =>
            onResolve(resolveField(result, conflict.clipId, conflict.field, "ours"))
          }
        >
          Keep ours
        </button>{" "}
        <button
          onClick={() =>
            onResolve(resolveField(result, conflict.clipId, conflict.field, "theirs"))
          }
        >
          Take theirs
        </button>
      </li>
    );
  }
  if (conflict.kind === "deleteModify") {
    return (
      <li style={{ marginBottom: 6 }}>
        <span style={{ color: "#ff6b6b" }}>[delete-vs-edit]</span>{" "}
        {conflict.clipId} deleted on one side, edited on the other.{" "}
        <button onClick={() => onResolve(resolveDeleteModify(result, conflict.clipId, true))}>
          Keep clip
        </button>{" "}
        <button
          onClick={() => onResolve(resolveDeleteModify(result, conflict.clipId, false))}
        >
          Remove clip
        </button>
      </li>
    );
  }
  return (
    <li style={{ marginBottom: 6 }}>
      <span style={{ color: "#ff6b6b" }}>[overlap]</span> {conflict.a} and{" "}
      {conflict.b} collide on {conflict.trackId}.{" "}
      <button onClick={() => onResolve(resolveOverlap(result, conflict.a, conflict.b))}>
        Keep {conflict.a}
      </button>{" "}
      <button onClick={() => onResolve(resolveOverlap(result, conflict.b, conflict.a))}>
        Keep {conflict.b}
      </button>
    </li>
  );
}

/**
 * Git for video, first face: branches, commits, merge with explicit
 * conflict resolution. Every resolution is a side-pick or a removal —
 * the UI cannot invent timeline content the engine didn't produce.
 */
export function VersionControl() {
  const repo = useVcsStore((state) => state.repo);
  const pending = useVcsStore((state) => state.pending);
  const timeline = useEditorStore((state) => state.timeline);
  const [message, setMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [mergeSource, setMergeSource] = useState("");

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
      return diffTimelines(head(repo).timeline, timeline).changes.length;
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
        <select
          value={repo.currentBranch}
          onChange={(event) => checkoutGuarded(event.target.value)}
        >
          {branches.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>{" "}
        {dirty > 0 && (
          <span style={{ color: "#ffd43b" }}>
            ({dirty} uncommitted change{dirty === 1 ? "" : "s"})
          </span>
        )}
        <input
          placeholder="new branch"
          value={branchName}
          onChange={(event) => setBranchName(event.target.value)}
          style={{ marginLeft: 8, width: 110 }}
        />
        <button
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
        </button>
      </header>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          placeholder="commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          style={{ flex: 1 }}
        />
        <button
          disabled={dirty === 0 || message.trim().length === 0}
          onClick={() => {
            store.commitCurrent(message.trim());
            setMessage("");
          }}
        >
          Commit
        </button>
      </div>

      <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0 }}>
        {history.map((commit) => (
          <li key={commit.id} style={{ marginBottom: 3 }}>
            <span
              style={{
                display: "inline-block", width: 8, height: 8,
                borderRadius: "50%", marginRight: 6,
                background: authorColor(commit.author),
              }}
            />
            <code>{commit.id}</code> {commit.message}{" "}
            <span style={{ color: "#868e96" }}>
              — {commit.author}
              {commit.parents.length > 1 ? ` (merge of ${commit.parents.join(" + ")})` : ""}
            </span>
          </li>
        ))}
      </ul>

      {pending === null ? (
        <div style={{ display: "flex", gap: 6 }}>
          <select
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
          <button
            disabled={mergeSource === ""}
            onClick={() => {
              try {
                store.beginMerge(mergeSource);
              } catch (error) {
                alert(error instanceof Error ? error.message : "merge failed");
              }
            }}
          >
            Merge
          </button>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #495057", borderRadius: 4, padding: 8, marginTop: 4,
          }}
        >
          <header style={{ marginBottom: 6 }}>
            Merging <strong>{pending.sourceBranch}</strong> into{" "}
            <strong>{repo.currentBranch}</strong> (base {pending.baseId}) —{" "}
            {pending.result.clean
              ? "clean, ready to commit"
              : `${pending.result.conflicts.length} conflict(s) to resolve`}
          </header>
          {!pending.result.clean && (
            <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0 }}>
              {pending.result.conflicts.map((conflict, index) => (
                <ConflictRow
                  key={index}
                  conflict={conflict}
                  result={pending.result}
                  onResolve={store.setResult}
                />
              ))}
            </ul>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <input
              placeholder="merge commit message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              style={{ flex: 1 }}
            />
            <button
              disabled={!pending.result.clean || message.trim().length === 0}
              onClick={() => {
                store.commitMerge(message.trim());
                setMessage("");
              }}
            >
              Commit merge
            </button>
            <button onClick={store.cancelMerge}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
