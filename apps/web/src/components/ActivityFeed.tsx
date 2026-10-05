import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import { describeOp } from "../lib/describeOp";
import { authorColor } from "../lib/identity";

/**
 * The op log, rendered as English. Reads history directly — never the
 * timeline — so it shows what happened, including entries undone since
 * (dimmed past the cursor). Newest at the bottom, auto-follows.
 */
export function ActivityFeed() {
  const history = useEditorStore((state) => state.history);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [history.log.length, history.cursor]);

  if (history.log.length === 0) {
    return (
      <section
        aria-label="activity"
        style={{
          border: "1px solid #2c2e33", borderRadius: 6, background: "#101114",
          padding: "8px 12px", marginTop: 12, fontSize: 12, color: "#868e96",
        }}
      >
        No edits yet — every op will appear here with its author.
      </section>
    );
  }

  return (
    <section
      aria-label="activity"
      style={{
        border: "1px solid #2c2e33", borderRadius: 6, background: "#101114",
        padding: "8px 12px", marginTop: 12, fontSize: 12,
        maxHeight: 160, overflowY: "auto",
      }}
    >
      <header style={{ color: "#868e96", marginBottom: 6 }}>
        Activity — who made what
      </header>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {history.log.map((entry, index) => {
          const undone = index >= history.cursor;
          return (
            <li
              key={entry.seq}
              style={{
                marginBottom: 3,
                opacity: undone ? 0.4 : 1,
                textDecoration: undone ? "line-through" : "none",
              }}
            >
              <span
                style={{
                  display: "inline-block", width: 8, height: 8,
                  borderRadius: "50%", marginRight: 6,
                  background: authorColor(entry.author),
                }}
              />
              <span style={{ color: "#e9ecef" }}>{entry.author}</span>
              <span style={{ color: "#868e96" }}> {describeOp(entry.op)}</span>
              {undone && (
                <span style={{ color: "#868e96" }}> (undone)</span>
              )}
            </li>
          );
        })}
      </ul>
      <div ref={bottomRef} />
    </section>
  );
}
