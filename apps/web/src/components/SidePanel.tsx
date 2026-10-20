import { useState } from "react";
import { VersionControl } from "./VersionControl";
import { CommitGraph } from "./CommitGraph";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useEditorStore } from "../store";
import { formatTime } from "../theme";
import { useUiStore } from "../uiStore";
import { Button } from "./ui/button";

function MediaPanel() {  const assets = useEditorStore((state) => state.timeline.assets);
  const entries = Object.values(assets);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {entries.length === 0 ? (
        <p style={{ fontSize: 12, color: "#868e96", margin: 0 }}>
          No media yet. Use Add video in the title bar to import a file.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {entries.map((asset) => (
            <li
              key={asset.id}
              style={{
                fontSize: 12,
                padding: "6px 8px",
                border: "1px solid #2c2e33",
                borderRadius: 6,
                marginBottom: 6,
              }}
            >
              <div style={{ fontFamily: "ui-monospace, monospace" }}>
                {asset.id.slice(0, 16)}
              </div>
              <div style={{ color: "#868e96", fontSize: 11 }}>
                {asset.kind} · {formatTime(asset.duration)}
                {asset.bytes !== undefined
                  ? ` · ${(asset.bytes / 1048576).toFixed(1)} MB`
                  : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VersionsPanel() {
  const [view, setView] = useState<"history" | "graph">("history");
  return (
    <div className="flex flex-col">
      <div className="mb-2 flex gap-1">
        {(["history", "graph"] as const).map((id) => (
          <button
            key={id}
            onClick={() => setView(id)}
            aria-pressed={view === id}
            className={`rounded-md px-2.5 py-1 text-[12px] ${
              view === id
                ? "bg-[#23262c] text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {id === "history" ? "History" : "Graph"}
          </button>
        ))}
      </div>
      {view === "history" ? <VersionControl /> : <CommitGraph />}
    </div>
  );
}

/**
 * The panel beside the activity rail. Its content follows the rail
 * selection: Media, Versions (source control) or Issues (lint).
 */
export function SidePanel() {
  const rail = useUiStore((state) => state.rail);
  const setBottomTab = useUiStore((state) => state.setBottomTab);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {rail === "media" && <MediaPanel />}
      {rail === "versions" && <VersionsPanel />}
      {rail === "issues" && (
        <>
          <DiagnosticsPanel />
          <div style={{ marginTop: 10 }}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBottomTab("issues")}
            >
              Open issues panel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
