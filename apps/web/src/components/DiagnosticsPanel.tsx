import {explainDiagnostic} from "../lib/diagnosticExplanation";
import { useMemo } from "react";
import { lint } from "@cutroom/engine";
import { useUiStore } from "../uiStore";
import { useEditorStore } from "../store";

/**
 * The linter, made visible. Recomputes only when the timeline object
 * changes — never on playhead ticks or selection. Clicking a diagnostic
 * jumps the playhead to it and selects the first involved clip.
 */
export function DiagnosticsPanel() {
  const timeline = useEditorStore((state) => state.timeline);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const selectClip = useEditorStore((state) => state.selectClip);

  const diagnostics = useMemo(() => lint(timeline), [timeline]);
  const errors = diagnostics.filter((d) => d.severity === "error").length;

  return (
    <section
      aria-label="diagnostics"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        background: "var(--color-card)",
        padding: "8px 12px",
        marginTop: 12,
        fontSize: 12,
      }}
    >
      <header style={{ color: "var(--color-muted)", marginBottom: 6 }}>
        Timeline checks — {diagnostics.length} finding{diagnostics.length === 1 ? "" : "s"}
        {errors > 0 ? ` (${errors} structural errors)` : ""}
      </header>
      {Object.keys(timeline.clips).length === 0 ? <div className="text-muted">No clips to verify. Build a sequence before checking its structure.</div> : diagnostics.length === 0 ? (
        <div style={{ color: "var(--color-success)" }}>No structural findings. Play through the cut to judge picture, sound, and intent.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {diagnostics.map(diagnostic => {
            const explanation = explainDiagnostic(timeline, diagnostic);
            return (
              <li key={diagnostic.key} className="issue-item">
                <strong>{diagnostic.severity === "error" && <span className="text-destructive">Error · </span>}{explanation.title}</strong>
                <span className="finding-location">{explanation.location}</span>
                <p className="finding-explanation">{explanation.explanation}</p>
                {(diagnostic.where !== undefined || diagnostic.clipIds.length > 0) && <button
                  type="button" className="diagnostic-finding" aria-label={`Show on timeline: ${explanation.title}`}
                  onClick={() => {
                    useUiStore.getState().openTab("timeline");
                    if (diagnostic.where !== undefined) setPlayhead(diagnostic.where);
                    selectClip(diagnostic.clipIds[0] ?? null);
                  }}>Show on timeline</button>}
              </li>
          );})}
        </ul>
      )}
    </section>
  );
}
