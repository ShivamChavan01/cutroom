import { useMemo } from "react";
import { AlertTriangle, Film, GitBranch, Settings, SlidersHorizontal } from "lucide-react";
import { lint } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { type RailItem, useUiStore } from "../uiStore";

const ITEMS: { id: RailItem | "inspector"; label: string; icon: typeof Film }[] = [
  { id: "media", label: "Media", icon: Film },
  { id: "versions", label: "Versions", icon: GitBranch },
  { id: "issues", label: "Issues", icon: AlertTriangle },
  { id: "inspector", label: "Properties", icon: SlidersHorizontal },
  { id: "settings", label: "Settings", icon: Settings },
];

export function ActivityBar() {
  const active = useUiStore(state => state.propertiesTab ?? state.rail);
  const timeline = useEditorStore(state => state.timeline);
  const issueCount = useMemo(() => lint(timeline).length, [timeline]);

  return (
    <nav aria-label="Project tools" className="workspace-rail">
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" id={`open-${id}`} aria-expanded={active === id}
          aria-controls="properties-sidebar" aria-label={label} title={label}
          aria-description={id === "issues" && issueCount > 0 ? `${issueCount} open` : undefined}
          onClick={() => {
            const ui = useUiStore.getState();
            if (id === "inspector") ui.setPropertiesTab(active === id ? null : id);
            else ui.setRail(active === id ? null : id);
          }}>
          <Icon aria-hidden="true" size={18} />
          <span>{label}</span>
          {id === "issues" && issueCount > 0 && <small aria-hidden="true">{issueCount}</small>}
        </button>
      ))}
    </nav>
  );
}
