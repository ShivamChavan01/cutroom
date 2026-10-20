import { useMemo } from "react";
import { useVcsStore } from "../vcsStore";
import { useEditorStore } from "../store";
import { Button } from "./ui/button";

/**
 * Diff view — an editor tab. Lists what changed between two commits,
 * branches, or the working copy, and lets the user jump to the clip.
 * The timeline shows the same diff as tints, ghosts and moved-links.
 */
export function DiffPanel() {
  const diffOverlay = useVcsStore((state) => state.diffOverlay);
  const store = useVcsStore.getState();
  const selectClip = useEditorStore((state) => state.selectClip);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);

  const rows = useMemo(() => {
    if (diffOverlay === null) return [];
    return diffOverlay.diff.changes.map((change) => {
      switch (change.kind) {
        case "added":
          return { id: change.clip.id, kind: "added" as const, text: `added ${change.clip.id}` };
        case "removed":
          return { id: change.clip.id, kind: "removed" as const, text: `removed ${change.clip.id}` };
        case "moved":
          return {
            id: change.after.id,
            kind: "moved" as const,
            text: `moved ${change.after.id} ${Math.round((change.after.start - change.before.start) / 100) / 10}s`,
          };
        case "trimmed":
          return {
            id: change.after.id,
            kind: "trimmed" as const,
            text: `trimmed ${change.after.id} (in ${Math.round(change.deltaIn / 100) / 10}s, dur ${Math.round(change.deltaDuration / 100) / 10}s)`,
          };
        case "edited":
          return {
            id: change.after.id,
            kind: "edited" as const,
            text: `edited ${change.after.id} (${change.fields.join(", ")})`,
          };
      }
    });
  }, [diffOverlay]);

  if (diffOverlay === null) {
    return (
      <div className="p-4 text-[13px] text-muted">
        No comparison active. Pick two versions in the Versions panel and
        choose Compare.
      </div>
    );
  }

  const tint: Record<string, string> = {
    added: "#51cf66",
    removed: "#ff6b6b",
    moved: "#74c0fc",
    trimmed: "#ffd43b",
    edited: "#b197fc",
  };

  return (
    <div className="p-3">
      <header className="mb-3 flex items-center gap-2 text-[12px] text-muted">
        <span>
          {diffOverlay.baseLabel} → {diffOverlay.targetLabel}
        </span>
        <span>
          {diffOverlay.diff.added} added · {diffOverlay.diff.removed} removed ·{" "}
          {diffOverlay.diff.changed} changed
        </span>
        <Button size="sm" variant="ghost" onClick={store.clearDiff}>
          Clear
        </Button>
      </header>
      <ul className="m-0 list-none p-0">
        {rows.map((row, index) => (
          <li key={`${row.id}-${index}`} className="mb-1 text-[12px]">
            <button
              className="cursor-pointer bg-transparent text-left hover:underline"
              style={{ color: tint[row.kind] }}
              onClick={() => {
                selectClip(row.id);
                const clip = useEditorStore.getState().timeline.clips[row.id];
                if (clip !== undefined) setPlayhead(clip.start);
              }}
            >
              {row.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
