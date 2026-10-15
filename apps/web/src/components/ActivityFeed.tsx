import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import { describeOp } from "../lib/describeOp";
import { authorColor } from "../lib/identity";

/**
 * The op log as a session transcript: one row per op, newest at the
 * bottom, auto-following — the shape Claude Code users already read.
 * Status glyph per row: ✓ applied, ↩ undone (dimmed past the cursor).
 * Reads history directly, never the timeline.
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
        className="rounded-md border border-border bg-card p-3 font-mono text-xs text-muted"
      >
        <span className="text-faint">$</span> no ops yet — every edit lands here with its author.
      </section>
    );
  }

  return (
    <section
      aria-label="activity"
      className="max-h-64 overflow-y-auto rounded-md border border-border bg-card p-3 font-mono text-xs"
    >
      <header className="mb-1.5 text-muted">
        <span className="text-faint">$</span> session — {history.log.length} op{history.log.length === 1 ? "" : "s"}
      </header>
      <ul className="m-0 list-none p-0">
        {history.log.map((entry, index) => {
          const undone = index >= history.cursor;
          return (
            <li
              key={entry.seq}
              className={undone ? "mb-1 opacity-40" : "mb-1"}
            >
              <span className={undone ? "text-faint" : "text-success"} aria-hidden>
                {undone ? "↩ " : "✓ "}
              </span>
              <span
                className="mr-1.5 inline-block size-2 rounded-full"
                style={{ background: authorColor(entry.author) }}
                title={entry.author}
              />
              <span className="text-foreground">{entry.author}</span>{" "}
              <span className="text-muted">{describeOp(entry.op)}</span>
              <span className="text-faint"> #{entry.seq}</span>
            </li>
          );
        })}
      </ul>
      <div ref={bottomRef} />
    </section>
  );
}
