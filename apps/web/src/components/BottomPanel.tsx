import { useMemo } from "react";
import { lint } from "@cutroom/engine";
import { ActivityFeed } from "./ActivityFeed";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useEditorStore } from "../store";
import { type BottomTab, useUiStore } from "../uiStore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";

/**
 * Bottom panel: Issues (linter output) and Activity (the op transcript).
 * Both are real views of real state — no placeholder content.
 */
export function BottomPanel() {
  const bottomTab = useUiStore((state) => state.bottomTab);
  const setBottomTab = useUiStore((state) => state.setBottomTab);
  const timeline = useEditorStore((state) => state.timeline);
  const issueCount = useMemo(() => lint(timeline).length, [timeline]);

  const tabs: { id: BottomTab; label: string; badge?: number }[] = [
    { id: "issues", label: "Issues", badge: issueCount },
    { id: "activity", label: "Activity" },
  ];

  return (
    <Tabs value={bottomTab} onValueChange={(value) => { if (value === "issues" || value === "activity") setBottomTab(value); }} className="h-full bg-card">
      <TabsList variant="line" aria-label="Review views">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="ml-1.5 rounded-full bg-warn px-1.5 text-[10px] font-medium text-black">
                {tab.badge}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={bottomTab} className="flex-1 overflow-y-auto p-2.5">
        {bottomTab === "issues" ? <DiagnosticsPanel /> : <ActivityFeed />}
      </TabsContent>
    </Tabs>
  );
}
