import { useMemo, useState } from "react";
import {type Conflict, type MergeResult, lintDelta, conflictKey} from "@cutroom/engine";
import type {MergeChoice} from "../lib/mergeSession";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function ConflictRow({conflict, result, onResolve}: {
  conflict: Conflict; result: MergeResult; onResolve: (key: string, choice: MergeChoice) => void;
}) {
  const choose = (choice: MergeChoice) => onResolve(conflictKey(conflict), choice);
  switch (conflict.kind) {
    case "assetField": case "trackField": case "assetPresence": case "trackPresence": case "trackOrder": {
      const label = conflict.kind === "assetField" ? `Asset ${conflict.assetId}.${conflict.field}`
        : conflict.kind === "trackField" ? `Track ${conflict.trackId}.${conflict.field}`
        : conflict.kind === "assetPresence" ? `Asset ${conflict.assetId} deletion`
        : conflict.kind === "trackPresence" ? `Track ${conflict.trackId} deletion` : "Track order";
      return <li className="merge-choice">{label}: {JSON.stringify(conflict.ours) ?? "deleted"} / {JSON.stringify(conflict.theirs) ?? "deleted"}
        <Button size="sm" onClick={() => choose("ours")}>Keep ours</Button>
        <Button size="sm" onClick={() => choose("theirs")}>Take theirs</Button>
        {(conflict.kind === "assetPresence" || conflict.kind === "trackPresence") && <Button size="sm" onClick={() => choose("keep")}>Keep metadata</Button>}
      </li>;
    }
    case "project":
      return <li className="merge-choice">Project {conflict.field}: {String(conflict.ours)} / {String(conflict.theirs)}<Button size="sm" onClick={() => choose("ours")}>Keep ours</Button><Button size="sm" onClick={() => choose("theirs")}>Take theirs</Button></li>;
    case "field":
      return <li className="merge-choice"><span className="text-warn">[field]</span> {conflict.clipId}.{conflict.field}: ours {String(conflict.ours)} vs theirs {String(conflict.theirs)} <Button size="sm" onClick={() => choose("ours")}>Keep ours</Button><Button size="sm" onClick={() => choose("theirs")}>Take theirs</Button></li>;
    case "deleteModify":
      return <li className="merge-choice">[delete-vs-edit] {conflict.clipId} was removed in one cut and edited in the other. <Button size="sm" onClick={() => choose("keep")}>Keep clip</Button><Button size="sm" variant="destructive" onClick={() => choose("remove")}>Remove clip</Button></li>;
    case "overlap": {
      const track = result.merged.tracks.find(item => item.id === conflict.trackId);
      return <li className="merge-choice merge-overlap">
        <strong>Two edits place clips at overlapping times.</strong>
        <p><code>{conflict.a}</code> and <code>{conflict.b}</code> overlap on {track?.kind ?? "video"} track {track?.name ?? conflict.trackId} from {(conflict.overlapStart / 1000).toFixed(2)}s to {(conflict.overlapEnd / 1000).toFixed(2)}s.</p>
        <p>Choose which clip belongs in this cut. Keeping one removes the other; its timing stays unchanged.</p>
        <div className="merge-overlap-actions">
          <div><Button size="sm" onClick={() => choose("a")}>Keep {conflict.a}</Button><small>Removes {conflict.b}</small></div>
          <div><Button size="sm" onClick={() => choose("b")}>Keep {conflict.b}</Button><small>Removes {conflict.a}</small></div>
        </div>
      </li>;
    }
    default: {const exhaustive: never = conflict; return exhaustive;}
  }
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
  const [resolutionError, setResolutionError] = useState<string | null>(null);
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
      {resolutionError !== null && <p role="alert" className="text-destructive">{resolutionError}</p>}
      <p className="merge-save-note">This merge is pending. Choices save locally; wait for saved before refreshing. Cancel keeps your original cut.</p>
      {!pending.result.clean && (
        <ul className="m-0 mb-3 list-none p-0">
          {pending.result.conflicts.map((conflict) => (
            <ConflictRow
              key={conflictKey(conflict)}
              conflict={conflict}
              result={pending.result}
              onResolve={(key, choice) => {try {store.resolveConflict(key, choice); setResolutionError(null);} catch (error) {setResolutionError(error instanceof Error ? error.message : "Could not record the choice.");}}}
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
            try {
              store.commitMerge(message.trim());
              setMessage("");
              setConfirmed(false);
            } catch (error) {
              window.alert(error instanceof Error ? error.message : "Merge commit failed");
            }
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
