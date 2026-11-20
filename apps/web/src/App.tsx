import { isDemoWorkspace } from "./lib/workspace";
import { DemoGuide } from "./components/DemoGuide";
import { usePersistenceStore } from "./lib/persistence/persistenceStore";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Group, useGroupRef } from "react-resizable-panels";
import { layoutForPanels, readLayout, writeLayout } from "./lib/layout";
import { MessageSquare, PanelLeftClose, PanelRightClose } from "lucide-react";
import { useUiStore } from "./uiStore";
import { ProjectSettings } from "./components/ProjectSettings";
import { readViewPreferences, writeViewPreferences } from "./lib/viewPreferences";
import { Preview } from "./components/Preview";
import { EditorArea } from "./components/EditorArea";
import { ActivityFeed } from "./components/ActivityFeed";
import { SidePanel } from "./components/SidePanel";
import { CommandPalette } from "./components/CommandPalette";
import { StatusBar } from "./components/StatusBar";
import { ActivityBar } from "./components/ActivityBar";
import { TopBar } from "./components/TopBar";
import { Inspector } from "./components/Inspector";
import { AssistantPanel } from "./components/AssistantPanel";
import { Panel, ResizableGroup, ResizeHandle } from "./components/ResizableGroup";
import { deleteSelected, splitAtPlayhead } from "./lib/actions";
import { useProjectPersistence } from "./lib/persistence/usePersistence";
import { useEditorStore } from "./store";

function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return (
    target !== null &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}

export function App() {
  useProjectPersistence();
  const hydrated = usePersistenceStore((state) => state.hydrated);
  const rail = useUiStore((state) => state.rail);
  const propertiesTab = useUiStore(state => state.propertiesTab);
  const setPropertiesTab = useUiStore(state => state.setPropertiesTab);
  const reviewOpen = useUiStore((state) => state.reviewOpen);
  const activePanel = propertiesTab ?? rail;

  useEffect(() => {
    let storage: Storage;
    try { storage = window.localStorage; } catch { return; }
    const saved = readViewPreferences(storage);
    if (saved !== null) useUiStore.setState(saved);
    return useUiStore.subscribe((state, previous) => {
      if (state.hiddenTrackIds !== previous.hiddenTrackIds || state.mutedTrackIds !== previous.mutedTrackIds || state.lockedTrackIds !== previous.lockedTrackIds) writeViewPreferences(storage, state);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        useEditorStore.getState().redo();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
      } else if (event.key.toLowerCase() === "s") {
        splitAtPlayhead();
      } else if (event.key === " ") {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, summary")) return;
        event.preventDefault();
        const store = useEditorStore.getState();
        if (store.isPlaying) store.pause();
        else store.play();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const group = useGroupRef();
  const assistantOpen = propertiesTab === "assistant";
  const sidebarOpen = activePanel !== null && !assistantOpen;
  const dock = assistantOpen ? "assistant" : sidebarOpen ? "properties" : null;
  const widths = useRef({ properties: 34, assistant: 32 });
  useLayoutEffect(() => {
    if (!hydrated || !group.current) return;
    let width = dock ? widths.current[dock] : 0;
    if (dock) {
      try {
        const saved = readLayout(window.localStorage, dock === "assistant" ? "assistant-sidebar-width" : "editor-sidebar-width");
        width = layoutForPanels(saved, ["viewer", dock], { viewer: 100 - width, [dock]: width })[dock] ?? width;
      } catch { /* Use the session width if storage is unavailable. */ }
    }
    group.current.setLayout({ properties: dock === "properties" ? width : 0, viewer: 100 - width, assistant: dock === "assistant" ? width : 0 });
  }, [dock, hydrated, group]);

  const sidebarHeading = useRef<HTMLHeadingElement>(null);
  const assistantHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (activePanel !== null) (activePanel === "assistant" ? assistantHeading : sidebarHeading).current?.focus({ preventScroll: true });
  }, [activePanel]);

  const closeTool = () => {
    document.getElementById(`open-${activePanel}`)?.focus({ preventScroll: true });
    setPropertiesTab(null);
  };

  if (!hydrated) return <main className="workspace-loading" style={{inset: 0}} role="status">Restoring workspace…</main>;

  return (
    <div className="studio-shell editorial-shell flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <div className="mobile-notice" role="note">Cutroom editing is designed for desktop. Use a screen at least 1024px wide for the complete workspace.</div>
      {isDemoWorkspace() && <DemoGuide />}
      <CommandPalette />
      <div className="editorial-body">
        <ActivityBar />
        <Group groupRef={group} orientation="horizontal" defaultLayout={{ properties: 0, viewer: 100, assistant: 0 }}
          onLayoutChange={layout => {
            if (!dock || !layout[dock] || layout[dock === "assistant" ? "properties" : "assistant"] !== 0) return;
            const width = layout[dock];
            widths.current[dock] = width;
            try { writeLayout(window.localStorage, dock === "assistant" ? "assistant-sidebar-width" : "editor-sidebar-width", { viewer: 100 - width, [dock]: width }); } catch { /* Keep the session width. */ }
          }}>
          <Panel id="properties" collapsible collapsedSize={0} minSize="344px" maxSize="60%"
            onResize={(size, _id, previous) => {
              const ui = useUiStore.getState();
              if (size.inPixels === 0 && previous && previous.inPixels > 0 && (ui.propertiesTab === "inspector" || ui.rail)) closeTool();
            }}>
            <aside id="properties-sidebar" aria-label="Editor tools sidebar" hidden={!sidebarOpen}
              className="studio-properties properties-panel" onKeyDown={event => {
                if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); closeTool(); }
              }}>
              <header className="editor-tool-heading">
                <h2 ref={sidebarHeading} tabIndex={-1}>{propertiesTab === "inspector" ? "Properties" : activePanel && activePanel[0]?.toUpperCase() + activePanel.slice(1)}</h2>
                <button type="button" onClick={closeTool} aria-label="Close sidebar" title="Close sidebar"><PanelLeftClose size={17} /></button>
              </header>
              {rail && <div className="studio-library-content tool-project-content">
                {rail === "settings" ? <ProjectSettings /> : <SidePanel />}
              </div>}
              <div hidden={propertiesTab !== "inspector"} className="properties-inspector"><Inspector /></div>
            </aside>
          </Panel>
          {sidebarOpen && <ResizeHandle orientation="vertical" />}
          <Panel id="viewer" minSize="40%">
            <div className="editorial-workspace">
              <ResizableGroup
                groupId="editor-preview-timeline"
                orientation="vertical"
                panelIds={["monitors", "sequence"]}
                defaultLayout={{ monitors: 66, sequence: 34 }}
              >
                <Panel id="monitors" minSize="30%">
                  <div className="studio-viewer"><Preview /></div>
                </Panel>
                <ResizeHandle orientation="horizontal" />
                <Panel id="sequence" minSize="250px">
                  <section aria-label="Sequence workspace" className="studio-sequence"><div className="editorial-timeline"><EditorArea /></div></section>
                </Panel>
              </ResizableGroup>
              {reviewOpen && <section id="editing-activity" className="studio-review-content" aria-label="Editing activity"><ActivityFeed /></section>}
            </div>
          </Panel>
          {assistantOpen && <ResizeHandle orientation="vertical" />}
          <Panel id="assistant" collapsible collapsedSize={0} minSize="344px" maxSize="60%"
            onResize={(size, _id, previous) => {
              if (size.inPixels === 0 && previous && previous.inPixels > 0 && useUiStore.getState().propertiesTab === "assistant") closeTool();
            }}>
            <aside id="assistant-sidebar" className="properties-panel assistant-dock" hidden={!assistantOpen}
              aria-labelledby="assistant-title" onKeyDown={event => {
                if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); closeTool(); }
              }}>
              <header className="editor-tool-heading">
                <h2 ref={assistantHeading} tabIndex={-1} id="assistant-title"><MessageSquare size={17} aria-hidden />Assistant</h2>
                <button type="button" onClick={closeTool} aria-label="Close Assistant" title="Close Assistant"><PanelRightClose size={17} /></button>
              </header>
              <div className="properties-assistant"><AssistantPanel active={assistantOpen} /></div>
            </aside>
          </Panel>
        </Group>
      </div>
      <StatusBar />
    </div>
  );
}
