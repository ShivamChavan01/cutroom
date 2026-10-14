import { useMemo } from "react";
import { authorsByClip, lint } from "@cutroom/engine";
import { authorColor } from "../lib/identity";
import { canSplitAtPlayhead, deleteSelected, splitAtPlayhead } from "../lib/actions";
import { useEditorStore, useSelection } from "../store";
import { formatTime, theme } from "../theme";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
      <span style={{ color: theme.dim }}>{label}</span>
      <span style={{ fontFamily: "ui-monospace, monospace" }}>{value}</span>
    </div>
  );
}

/**
 * Right rail: what is selected, what the linter says about it, what you
 * can do to it. Nothing here mutates except through shared actions.
 */
export function Inspector() {
  const timeline = useEditorStore((state) => state.timeline);
  const history = useEditorStore((state) => state.history);
  const selection = useSelection();
  const clip = selection !== null ? timeline.clips[selection] : undefined;

  const authors = useMemo(() => authorsByClip(history), [history]);
  const selectionIssues = useMemo(() => {
    if (selection === null) return [];
    return lint(timeline).filter((d) => d.clipIds.includes(selection));
  }, [timeline, selection]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 12, color: theme.dim, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Inspector
        </h3>
        {clip === undefined ? (
          <p style={{ fontSize: 12, color: theme.dim, margin: 0 }}>
            Select a clip on the timeline to inspect it. Click empty lane space
            to deselect.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{clip.id}</span>
              {authors.get(clip.id) !== undefined && (
                <span
                  title={`last edited by ${authors.get(clip.id)}`}
                  style={{
                    display: "inline-block", width: 9, height: 9,
                    borderRadius: "50%",
                    background: authorColor(authors.get(clip.id)!),
                  }}
                />
              )}
              <span style={{ fontSize: 11, color: theme.dim }}>
                {authors.get(clip.id) ?? "unknown author"}
              </span>
            </div>
            <Row label="Track" value={clip.trackId} />
            <Row label="Start" value={formatTime(clip.start)} />
            <Row label="Duration" value={formatTime(clip.duration)} />
            <Row label="In-point" value={formatTime(clip.inPoint)} />
            <Row label="Source" value={clip.assetId.slice(0, 12)} />
            <Row label="Volume" value={String(clip.volume)} />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={splitAtPlayhead} title="S">Split at playhead</button>
              <button onClick={deleteSelected} title="Delete">Delete</button>
            </div>
            {!canSplitAtPlayhead() && (
              <p style={{ fontSize: 11, color: theme.faint, margin: "6px 0 0" }}>
                Move the playhead inside the clip to enable split.
              </p>
            )}
            {selectionIssues.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {selectionIssues.map((d, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 12,
                      color: d.severity === "error" ? theme.error : theme.warn,
                      marginBottom: 4,
                    }}
                  >
                    [{d.rule}] {d.message}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section
        style={{
          border: `1px dashed ${theme.border}`,
          borderRadius: theme.radius,
          padding: "8px 10px",
        }}
      >
        <h3 style={{ margin: "0 0 6px", fontSize: 12, color: theme.dim, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Agent
        </h3>
        <p style={{ fontSize: 12, color: theme.dim, margin: 0 }}>
          AI edits land here as proposed ops once an API key is configured.
          The engine stays the source of truth — the model narrates or
          proposes, never mutates directly.
        </p>
      </section>
    </div>
  );
}
