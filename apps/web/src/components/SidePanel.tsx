import { useMemo, useState } from "react";
import { lint } from "@cutroom/engine";
import { ActivityFeed } from "./ActivityFeed";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { UploadButton, ExportOitioButton } from "./UploadButton";
import { VersionControl } from "./VersionControl";
import { useEditorStore } from "../store";
import { formatTime, theme } from "../theme";

type Tab = "media" | "versions" | "activity" | "issues";

function MediaTab() {
  const assets = useEditorStore((state) => state.timeline.assets);
  const entries = Object.values(assets);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <UploadButton />
        <ExportOitioButton />
      </div>
      {entries.length === 0 ? (
        <p style={{ fontSize: 12, color: theme.dim, margin: 0 }}>
          No media yet. Upload a video to begin.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {entries.map((asset) => (
            <li
              key={asset.id}
              style={{
                fontSize: 12,
                padding: "6px 8px",
                border: `1px solid ${theme.border}`,
                borderRadius: theme.radius,
                marginBottom: 6,
              }}
            >
              <div style={{ fontFamily: "ui-monospace, monospace" }}>
                {asset.id.slice(0, 16)}
              </div>
              <div style={{ color: theme.dim, fontSize: 11 }}>
                {asset.kind} · {formatTime(asset.duration)}
                {asset.bytes !== undefined ? ` · ${(asset.bytes / 1048576).toFixed(1)} MB` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Left rail: media, versions, activity, issues. The editor's drawers —
 * everything that isn't preview or timeline lives behind these tabs.
 */
export function SidePanel() {
  const [tab, setTab] = useState<Tab>("media");
  const timeline = useEditorStore((state) => state.timeline);
  const issueCount = useMemo(() => lint(timeline).length, [timeline]);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "media", label: "Media" },
    { id: "versions", label: "Versions" },
    { id: "activity", label: "Activity" },
    { id: "issues", label: "Issues", badge: issueCount },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 2, marginBottom: 10 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            style={{
              flex: 1,
              fontSize: 12,
              padding: "6px 4px",
              background: tab === t.id ? "#1c1f24" : "transparent",
              border: `1px solid ${tab === t.id ? theme.border : "transparent"}`,
              borderRadius: theme.radius,
              color: tab === t.id ? theme.text : theme.dim,
              cursor: "pointer",
            }}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span
                style={{
                  marginLeft: 4,
                  fontSize: 10,
                  background: theme.warn,
                  color: "#000",
                  borderRadius: 8,
                  padding: "0 5px",
                }}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
        {tab === "media" && <MediaTab />}
        {tab === "versions" && <VersionControl />}
        {tab === "activity" && <ActivityFeed />}
        {tab === "issues" && <DiagnosticsPanel />}
      </div>
    </div>
  );
}
