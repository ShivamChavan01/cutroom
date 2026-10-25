import { useMemo, useState } from "react";
import {
  type MergeResult,
  lintDelta,
  resolveField,
  resolveProject,
} from "@cutroom/engine";
import { resolveDeleteModify, resolveOverlap } from "../lib/vcs";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function ConflictRow({
  conflict,
  result,
  onResolve,
}: {
  conflict: MergeResult["conflicts"][number];
  result: MergeResult;
  onResolve: (next: MergeResult) => void;
}) {
  if (conflict.kind === "project") {
    return <li className="merge-project-conflict">Project {conflict.field}: {String(conflict.ours)} / {String(conflict.theirs)}<Button size="sm" onClick={() => onResolve(resolveProject(result, conflict.field, "ours"))}>Keep ours</Button><Button size="sm" onClick={() => onResolve(resolveProject(result, conflict.field, "theirs"))}>Take theirs</Button></li>;
  }
  if (conflict.kind === "field") {
    return (
      <li className="mb-2 text-[12px]">
        <span className="text-warn">[field]</span>{" "}
        <span className="font-mono">{conflict.clipId}</span>.{conflict.field}: ours{" "}
        <span className="font-mono">{String(conflict.ours)}</span> vs theirs{" "}
        <span className="font-mono">{String(conflict.theirs)}</span>{" "}
        <Button
          size="sm"
          onClick={() =>
            onResolve(resolveField(result, conflict.clipId, conflict.field, "ours"))
          }
        >
          Keep ours
        </Button>{" "}
        <Button
          size="sm"
          onClick={() =>
            onResolve(resolveField(result, conflict.clipId, conflict.field, "theirs"))
          }
        >
          Take theirs
        </Button>
      </li>
    );
  }
  if (conflict.kind === "deleteModify") {
    return (
      <li className="mb-2 text-[12px]">
        <span className="text-destructive">[delete-vs-edit]</span>{" "}
        <span className="font-mono">{conflict.clipId}</span> deleted on one side,
        edited on the other.{" "}
        <Button
          size="sm"
          onClick={() => onResolve(resolveDeleteModify(result, conflict.clipId, true))}
        >
          Keep clip
        </Button>{" "}
        <Button
          size="sm"
          variant="destructive"
          onClick={() => onResolve(resolveDeleteModify(result, conflict.clipId, false))}
        >
          Remove clip
        </Button>
      </li>
    );
  }
  return (
    <li className="mb-2 text-[12px]">
      <span className="text-destructive">[overlap]</span>{" "}
      <span className="font-mono">{conflict.a}</span> and{" "}
      <span className="font-mono">{conflict.b}</span> collide on{" "}
      {conflict.trackId}.{" "}
      <Button
        size="sm"
        onClick={() => onResolve(resolveOverlap(result, conflict.a, conflict.b))}
      >
        Keep {conflict.a}
      </Button>{" "}
      <Button
        size="sm"
        onClick={() => onResolve(resolveOverlap(result, conflict.b, conflict.a))}
      >
        Keep {conflict.b}
      </Button>
    </li>
  );
}

/**
 * Merge conflict view — an editor tab, so the conflict sits next to the
 * timeline it belongs to. Every resolution is a side-pick or a removal:
 * the UI cannot invent timeline content the engine didn't produce.
 */
export function MergePanel() {
  const pending = useVcsStore((state) => state.pending);
  const repo = useVcsStore((state) => state.repo);
  const store = useVcsStore.getState();
  const timeline = useEditorStore((state) => state.timeline);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  /**
   * What the merge does to the linter's findings, measured against what is
   * on screen now. A merge is not blocked by this — but if it introduces
   * problems, the user has to say so explicitly before it is committed.
   */
  const delta = useMemo(
    () =>
      pending === null
        ? null
        : lintDelta(timeline, pending.result.merged),
    [pending, timeline],
  );
  const introduces = delta !== null && delta.introduced.length > 0;

  if (pending === null) {
    return (
      <div className="p-4 text-[13px] text-muted">
        No merge in progress. Start one from the Versions panel.
      </div>
    );
  }

  return (
    <div className="p-3">
      <header className="mb-3 text-[12px] text-muted">
        Merging <strong className="text-foreground">{pending.sourceBranch}</strong>{" "}
        into <strong className="text-foreground">{repo?.currentBranch}</strong>{" "}
        (base {pending.baseId}) —{" "}
        {pending.result.clean
          ? "clean, ready to commit"
          : `${pending.result.conflicts.length} conflict(s) to resolve`}
      </header>
      {!pending.result.clean && (
        <ul className="m-0 mb-3 list-none p-0">
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
      <div className="flex gap-1.5">
        <Input
          placeholder="merge commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="max-w-sm"
        />
        <Button
          size="sm"
          variant="default"
          disabled={
            !pending.result.clean ||
            message.trim().length === 0 ||
            (introduces && !confirmed)
          }
          onClick={() => {
            store.commitMerge(message.trim());
            setMessage("");
            setConfirmed(false);
          }}
        >
          Commit merge
        </Button>
        <Button size="sm" variant="ghost" onClick={store.cancelMerge}>
          Cancel
        </Button>
      </div>
      {introduces && (
        <div
          className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-[12px]"
        >
          <div className="text-destructive">
            This merge introduces {delta?.introduced.length} problem
            {delta?.introduced.length === 1 ? "" : "s"}:
          </div>
          <ul className="m-0 mt-1 list-none p-0">
            {delta?.introduced.map((diagnostic) => (
              <li key={diagnostic.key} className="text-muted">
                [{diagnostic.rule}] {diagnostic.message}
              </li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I understand this merge introduces problems — commit it anyway.
          </label>
        </div>
      )}
    </div>
  );
}
