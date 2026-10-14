import { useState } from "react";
import { HELP, parseCommand } from "../lib/commands";
import { useEditorStore } from "../store";
import { theme } from "../theme";

/**
 * Prompt bar: "describe the edit" compiles to engine ops through a fixed
 * grammar — no model, no guessing. Unparseable input errors inline with
 * the grammar. Chips are the same commands one click away.
 */
export function CommandBar({ compact = false }: { compact?: boolean }) {
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const submit = (raw: string) => {
    const store = useEditorStore.getState();
    const result = parseCommand(raw, {
      timeline: store.timeline,
      selectedClipId: store.selectedClipId,
      playheadMs: store.playheadMs,
    });
    if (result.ok) {
      result.run();
      setFeedback({ ok: true, message: result.message });
    } else {
      setFeedback({ ok: false, message: result.message });
    }
    setText("");
  };

  return (
    <div style={{ width: "100%", maxWidth: compact ? "100%" : 640 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#16181d",
          border: `1px solid ${theme.border}`,
          borderRadius: 10,
          padding: "10px 14px",
        }}
      >
        <span style={{ color: theme.dim }} aria-hidden>✦</span>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit(text);
            if (event.key === "Escape") {
              setText("");
              setFeedback(null);
            }
          }}
          placeholder="Describe the edit… (split here, close gaps, goto 12s)"
          aria-label="describe the edit"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: theme.text,
            fontSize: 14,
          }}
        />
        <button
          onClick={() => submit(text)}
          aria-label="run command"
          style={{
            borderRadius: 8,
            padding: "4px 12px",
            cursor: "pointer",
          }}
        >
          Run
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["close gaps", "split here", "undo"].map((chip) => (
          <button
            key={chip}
            onClick={() => submit(chip)}
            style={{
              fontSize: 12,
              borderRadius: 12,
              padding: "2px 12px",
              cursor: "pointer",
            }}
          >
            {chip}
          </button>
        ))}
        <span style={{ fontSize: 11, color: theme.faint }} title={HELP}>
          {feedback === null ? "fixed grammar, no guessing" : (
            <span style={{ color: feedback.ok ? theme.ok : theme.error }}>
              {feedback.message}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
