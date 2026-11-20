import { demoHref, isDemoWorkspace } from "../lib/workspace";
import { Upload, ChevronDown, MessageSquare } from "lucide-react";
import { UploadButton } from "./UploadButton";
import { ExportMenu } from "./ExportMenu";
import { useUiStore } from "../uiStore";
import { useEditorStore } from "../store";

/** Top strip: identity, branch, primary actions. Nothing decorative. */
export function TopBar() {
  const assistantOpen = useUiStore(state => state.propertiesTab === "assistant");
  const projectId = useEditorStore(state => state.timeline.id);
  return (
    <header className="studio-topbar">
      <div className="studio-brand"><span>cutroom<span className="studio-brand-dot">.</span></span></div>
      <div className="project-navigation">
        <button id="project-menu-trigger" className="project-trigger" type="button" popoverTarget="project-menu" aria-label="Project menu">
          {projectId === "untitled" ? "Untitled project" : projectId}<ChevronDown size={14} aria-hidden />
        </button>
        <div popover="auto" id="project-menu" className="project-popover">
          {isDemoWorkspace() && <button type="button" popoverTarget="sample-guide">Sample guide</button>}
          <a href={isDemoWorkspace() ? "?" : demoHref()} target="_blank" rel="noopener noreferrer">{isDemoWorkspace() ? "Personal workspace ↗" : "Try demo project ↗"}</a>
        </div>
      </div>
      <UploadButton icon={<Upload />} label="Add media" />
      <ExportMenu />
      <button type="button" id="open-assistant" aria-expanded={assistantOpen} aria-controls="assistant-sidebar"
        className="assistant-toggle" onClick={() => useUiStore.getState().setPropertiesTab(assistantOpen ? null : "assistant")}>
        <MessageSquare size={16} aria-hidden />Assistant
      </button>
    </header>
  );
}
