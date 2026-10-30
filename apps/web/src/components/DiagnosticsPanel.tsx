import { useMemo } from "react";
import { lint } from "@cutroom/engine";
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
        Linter — {diagnostics.length} issue{diagnostics.length === 1 ? "" : "s"}
        {errors > 0 ? ` (${errors} blocking)` : ""}
      </header>
      {Object.keys(timeline.clips).length === 0 ? <div className="text-muted">No clips to verify. Build a sequence before checking its structure.</div> : diagnostics.length === 0 ? (
        <div style={{ color: "var(--color-success)" }}>Clean — no issues found.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.rule}-${index}`} style={{ marginBottom: 4 }}>
              <button
                onClick={() => {
                  if (diagnostic.where !== undefined) {
                    setPlayhead(diagnostic.where);
                  }
                  selectClip(diagnostic.clipIds[0] ?? null);
                }}
                className={
                  diagnostic.severity === "error"
                    ? "cursor-pointer bg-transparent text-left text-[12px] text-destructive hover:underline"
                    : "cursor-pointer bg-transparent text-left text-[12px] text-warn hover:underline"
                }
              >
                [{diagnostic.rule}] {diagnostic.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
