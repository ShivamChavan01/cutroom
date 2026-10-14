import { useEffect } from "react";
import { Timeline } from "./components/Timeline";
import { Player } from "./components/Player";
import { TopBar } from "./components/TopBar";
import { SidePanel } from "./components/SidePanel";
import { Inspector } from "./components/Inspector";
import { TransportBar } from "./components/TransportBar";
import { deleteSelected, splitAtPlayhead } from "./lib/actions";
import { useEditorStore } from "./store";
import { theme } from "./theme";

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
 * Editor shell: preview center, drawers left, inspector right, timeline
 * along the bottom. Same store, same shortcuts, same components as before —
 * this file is layout only.
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: theme.bg,
        color: theme.text,
        fontFamily: theme.font,
        overflow: "hidden",
      }}
    >
      <TopBar />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          aria-label="panels"
          style={{
            width: 300,
            flexShrink: 0,
            borderRight: `1px solid ${theme.border}`,
            background: theme.panel,
            padding: 12,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <SidePanel />
        </aside>
        <main
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            padding: "12px 14px",
            overflowY: "auto",
          }}
        >
          <Player />
          <TransportBar />
          <Timeline />
          <p style={{ fontSize: 11, color: theme.faint, margin: "10px 0 0" }}>
            S split · Delete remove · Space play/pause · Ctrl+Z / Ctrl+Shift+Z
            undo/redo. Drag clip edges to trim (one op on release).
          </p>
        </main>
        <aside
          aria-label="inspector"
          style={{
            width: 264,
            flexShrink: 0,
            borderLeft: `1px solid ${theme.border}`,
            background: theme.panel,
            padding: 12,
            overflowY: "auto",
          }}
        >
          <Inspector />
        </aside>
      </div>
    </div>
  );
}
