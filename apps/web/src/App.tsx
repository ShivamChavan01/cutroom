import { useEffect } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { useUiStore } from "./uiStore";
import { VersionRail } from "./components/VersionRail";
import { ProjectSettings } from "./components/ProjectSettings";
import { readViewPreferences, writeViewPreferences } from "./lib/viewPreferences";
import { Preview } from "./components/Preview";
import { EditorArea } from "./components/EditorArea";
import { BottomPanel } from "./components/BottomPanel";
import { ActivityBar } from "./components/ActivityBar";
import { SidePanel } from "./components/SidePanel";
import { CommandPalette } from "./components/CommandPalette";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { Inspector } from "./components/Inspector";
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
      target.isContentEditable)
  );
}

export function App() {
  useProjectPersistence();
  const rail = useUiStore((state) => state.rail);
  const reviewOpen = useUiStore((state) => state.reviewOpen);
  const setReviewOpen = useUiStore((state) => state.setReviewOpen);

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
        if (target !== null && target.tagName === "BUTTON") return;
        event.preventDefault();
        const store = useEditorStore.getState();
        if (store.isPlaying) store.pause();
        else store.play();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="studio-shell editorial-shell flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <CommandPalette />
      <div className="editorial-body">
      <ActivityBar />
      <div className="editorial-workspace">
      <ResizableGroup
        groupId="editorial-workspace"
        orientation="vertical"
        panelIds={["monitors", "sequence"]}
        defaultLayout={{ monitors: 63, sequence: 37 }}
      >
        <Panel id="monitors" minSize={30}>
          <ResizableGroup
            groupId="editorial-monitors"
            orientation="horizontal"
            panelIds={["library", "viewer", "properties"]}
            defaultLayout={{ library: 28, viewer: 49, properties: 23 }}
          >
            <Panel id="library" minSize={18}>
              <div className="studio-library">
                <aside aria-label="side panel" className="studio-library-content">
                  {rail === "settings" ? <ProjectSettings /> : <SidePanel />}
                </aside>
              </div>
            </Panel>
            <ResizeHandle orientation="vertical" />
            <Panel id="viewer" minSize={35}>
              <div className="studio-viewer"><Preview /></div>
            </Panel>
            <ResizeHandle orientation="vertical" />
            <Panel id="properties" minSize={17}>
              <aside aria-label="inspector" className="studio-properties"><Inspector /></aside>
            </Panel>
          </ResizableGroup>
        </Panel>
        <ResizeHandle orientation="horizontal" />
        <Panel id="sequence" minSize={25}>
          <section aria-label="Sequence workspace" className="studio-sequence"><VersionRail /><div className="editorial-timeline"><EditorArea /></div></section>
        </Panel>
      </ResizableGroup>
      </div>
      </div>
      <section className={`studio-review${reviewOpen ? " is-open" : ""}`} aria-label="Review drawer">
        <button type="button" className="studio-review-toggle" aria-expanded={reviewOpen} onClick={() => setReviewOpen(!reviewOpen)}>
          <ShieldCheck size={13} aria-hidden /> Review
          <span>Verification & activity</span>
          <ChevronDown size={13} aria-hidden />
        </button>
        <div className="studio-review-content" hidden={!reviewOpen}><BottomPanel /></div>
      </section>
      <StatusBar />
    </div>
  );
}
