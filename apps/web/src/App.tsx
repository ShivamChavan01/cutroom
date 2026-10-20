import { useEffect } from "react";
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

/**
 * Editor shell.
 *
 *   TopBar
 *   ├─ ActivityBar (icon rail) │ centre │ Inspector
 *   ├─ workspace group: [centre column: preview / editor tabs] │ inspector
 *   ├─ Bottom panel (Issues / Activity)
 *   └─ StatusBar
 *
 * All four groups are resizable and their sizes persist per group id.
 */
export function App() {
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
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <CommandPalette />
      <ResizableGroup
        groupId="workspace"
        orientation="vertical"
        panelIds={["workspace", "bottom"]}
        defaultLayout={{ workspace: 74, bottom: 26 }}
        minSize={20}
      >
        <Panel id="workspace" minSize={30}>
          <div className="flex h-full min-h-0">
            <ActivityBar />
            <ResizableGroup
              groupId="shell"
              orientation="horizontal"
              panelIds={["side", "centre", "inspector"]}
              defaultLayout={{ side: 18, centre: 62, inspector: 20 }}
              minSize={10}
            >
              <Panel id="side" minSize={10}>
                <aside
                  aria-label="side panel"
                  className="h-full overflow-y-auto border-r border-border bg-card p-3"
                >
                  <SidePanel />
                </aside>
              </Panel>
              <ResizeHandle orientation="vertical" />
              <Panel id="centre" minSize={30}>
                <ResizableGroup
                  groupId="centre"
                  orientation="vertical"
                  panelIds={["preview", "editor"]}
                  defaultLayout={{ preview: 46, editor: 54 }}
                  minSize={15}
                >
                  <Panel id="preview" minSize={20}>
                    <div className="h-full overflow-y-auto p-3">
                      <Preview />
                    </div>
                  </Panel>
                  <ResizeHandle orientation="horizontal" />
                  <Panel id="editor" minSize={20}>
                    <div className="h-full overflow-hidden">
                      <EditorArea />
                    </div>
                  </Panel>
                </ResizableGroup>
              </Panel>
              <ResizeHandle orientation="vertical" />
              <Panel id="inspector" minSize={14}>
                <aside
                  aria-label="inspector"
                  className="h-full overflow-y-auto border-l border-border bg-card p-3"
                >
                  <Inspector />
                </aside>
              </Panel>
            </ResizableGroup>
          </div>
        </Panel>
        <ResizeHandle orientation="horizontal" />
        <Panel id="bottom" minSize={8}>
          <div className="h-full overflow-hidden">
            <BottomPanel />
          </div>
        </Panel>
      </ResizableGroup>
      <StatusBar />
    </div>
  );
}
