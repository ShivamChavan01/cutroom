import { AlertTriangle, Film, GitBranch, Settings } from "lucide-react";
import { ExportMenu } from "./ExportMenu";
import { lint } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { type RailItem, useUiStore } from "../uiStore";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "./ui/sidebar";

const ITEMS: { id: RailItem; label: string; icon: typeof Film }[] = [
  { id: "media", label: "Media", icon: Film },
  { id: "versions", label: "Versions", icon: GitBranch },
  { id: "issues", label: "Issues", icon: AlertTriangle },
];

/**
 * Fixed shadcn sidebar menu for switching the editor's workspace panels.
 */
export function ActivityBar() {
  const rail = useUiStore((state) => state.rail);
  const setRail = useUiStore((state) => state.setRail);
  const timeline = useEditorStore((state) => state.timeline);
  const issueCount = lint(timeline).length;

  return (
    <nav
      aria-label="activity bar"
      className="studio-library-tabs"
    >
      <div className="sidebar-group-label">Workspace</div>
      <SidebarMenu>
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = rail === item.id;
        return (
          <SidebarMenuItem key={item.id}>
          <SidebarMenuButton
            onClick={() => setRail(item.id)}
            isActive={active}
            title={item.label}
            aria-label={item.label}
          >
            <Icon className="size-4.5" aria-hidden />
            <span>{item.label}</span>
            {item.id === "issues" && issueCount > 0 && (
              <span
                className="sidebar-menu-badge"
                aria-label={`${issueCount} issues`}
              >
                {issueCount}
              </span>
            )}
          </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
      </SidebarMenu>
      <div className="sidebar-separator" />
      <div className="navigation-export"><ExportMenu sidebar /></div>
      <SidebarMenu className="sidebar-footer">
        <SidebarMenuItem><SidebarMenuButton isActive={rail === "settings"} onClick={() => setRail("settings")} aria-label="Settings" title="Settings"><Settings aria-hidden /><span>Settings</span></SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu>
    </nav>
  );
}
