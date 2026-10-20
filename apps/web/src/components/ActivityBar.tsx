import { AlertTriangle, Film, GitBranch } from "lucide-react";
import { lint } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { type RailItem, useUiStore } from "../uiStore";

const ITEMS: { id: RailItem; label: string; icon: typeof Film }[] = [
  { id: "media", label: "Media", icon: Film },
  { id: "versions", label: "Versions", icon: GitBranch },
  { id: "issues", label: "Issues", icon: AlertTriangle },
];

/**
 * Activity bar — the VS Code pattern: a narrow icon rail that switches
 * the panel beside it. Icons carry a tooltip and an aria-label; the
 * selected item is marked with aria-current, not colour alone.
 */
export function ActivityBar() {
  const rail = useUiStore((state) => state.rail);
  const setRail = useUiStore((state) => state.setRail);
  const timeline = useEditorStore((state) => state.timeline);
  const issueCount = lint(timeline).length;

  return (
    <nav
      aria-label="activity bar"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-2"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = rail === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setRail(item.id)}
            aria-current={active ? "page" : undefined}
            title={item.label}
            aria-label={item.label}
            className={`relative flex size-9 items-center justify-center rounded-md border transition-colors ${
              active
                ? "border-border bg-[#23262c] text-foreground"
                : "border-transparent text-muted hover:bg-[#1a1d22] hover:text-foreground"
            }`}
          >
            <Icon className="size-4.5" aria-hidden />
            {item.id === "issues" && issueCount > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 rounded-full bg-warn px-1 text-[10px] font-medium text-black"
                aria-label={`${issueCount} issues`}
              >
                {issueCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
