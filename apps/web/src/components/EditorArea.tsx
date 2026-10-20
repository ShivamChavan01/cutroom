import { useMemo } from "react";
import { Timeline } from "./Timeline";
import { DiffPanel } from "./DiffPanel";
import { MergePanel } from "./MergePanel";
import { useVcsStore } from "../vcsStore";
import { type EditorTab, useUiStore } from "../uiStore";

/**
 * Editor area: the timeline plus the diff and merge views, as tabs.
 * The diff and merge tabs appear only when there is something to show —
 * no empty placeholder tabs.
 */
export function EditorArea() {
  const editorTab = useUiStore((state) => state.editorTab);
  const openTab = useUiStore((state) => state.openTab);
  const diffOverlay = useVcsStore((state) => state.diffOverlay);
  const pending = useVcsStore((state) => state.pending);

  const tabs = useMemo(() => {
    const list: { id: EditorTab; label: string }[] = [
      { id: "timeline", label: "Timeline" },
    ];
    if (diffOverlay !== null) list.push({ id: "diff", label: "Diff" });
    if (pending !== null) list.push({ id: "merge", label: "Merge" });
    return list;
  }, [diffOverlay, pending]);

  // A tab can disappear (merge cancelled, diff cleared) — fall back to the
  // timeline rather than rendering nothing.
  const active = tabs.some((tab) => tab.id === editorTab) ? editorTab : "timeline";

  return (
    <div className="flex h-full flex-col">
      <div
        role="tablist"
        aria-label="editor views"
        className="flex shrink-0 items-end gap-1 border-b border-border bg-card px-1.5 pt-1"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => openTab(tab.id)}
            className={`rounded-t-md border-b-2 px-3 py-1.5 text-[12px] ${
              active === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.id === "merge" && pending !== null && !pending.result.clean && (
              <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] font-medium text-black">
                {pending.result.conflicts.length}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-background p-2.5">
        {active === "timeline" && <Timeline />}
        {active === "diff" && <DiffPanel />}
        {active === "merge" && <MergePanel />}
      </div>
    </div>
  );
}
