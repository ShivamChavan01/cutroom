import { useMemo } from "react";
import { lint } from "@cutroom/engine";
import { ActivityFeed } from "./ActivityFeed";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useEditorStore } from "../store";
import { type BottomTab, useUiStore } from "../uiStore";

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
    <div className="flex h-full flex-col bg-card">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 pt-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setBottomTab(tab.id)}
            aria-pressed={bottomTab === tab.id}
            className={`rounded-t-md border-b-2 px-3 py-1.5 text-[12px] ${
              bottomTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="ml-1.5 rounded-full bg-warn px-1.5 text-[10px] font-medium text-black">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {bottomTab === "issues" ? <DiagnosticsPanel /> : <ActivityFeed />}
      </div>
    </div>
  );
}
