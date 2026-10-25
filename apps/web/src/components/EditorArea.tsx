import { useMemo } from "react";
import { Timeline } from "./Timeline";
import { DiffPanel } from "./DiffPanel";
import { MergePanel } from "./MergePanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useVcsStore } from "../vcsStore";
import { type EditorTab, useUiStore } from "../uiStore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";

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
      { id: "verification", label: "Verification" },
    ];
    if (diffOverlay !== null) list.push({ id: "diff", label: "Diff" });
    if (pending !== null) list.push({ id: "merge", label: "Merge" });
    return list;
  }, [diffOverlay, pending]);

  // A tab can disappear (merge cancelled, diff cleared) — fall back to the
  // timeline rather than rendering nothing.
  const active = tabs.some((tab) => tab.id === editorTab) ? editorTab : "timeline";

  return (
    <Tabs value={active} onValueChange={(value) => { const tab = tabs.find((item) => item.id === value); if (tab !== undefined) openTab(tab.id); }} className="h-full">
      <TabsList
        variant="line"
        aria-label="editor views"
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
          >
            {tab.label}
            {tab.id === "merge" && pending !== null && !pending.result.clean && (
              <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] font-medium text-black">
                {pending.result.conflicts.length}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={active} className="flex-1 overflow-auto bg-background">
        {active === "timeline" && <Timeline />}
        {active === "diff" && <DiffPanel />}
        {active === "merge" && <MergePanel />}
        {active === "verification" && <DiagnosticsPanel />}
      </TabsContent>
    </Tabs>
  );
}
