import { useEffect, useMemo, useState } from "react";
import { buildActions, filterActions } from "../lib/palette";
import { Input } from "./ui/input";

/**
 * Ctrl+K command palette. Keyboard-first like the tools that inspired it:
 * type a few letters, Enter runs. Every entry is a real store action —
 * the list is generated, never hand-written per feature.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const actions = useMemo(() => buildActions(), [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setCursor(0);
        setOpen((was) => !was);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const matches = filterActions(actions, query);
  const visible = matches.filter((a) => a.enabled?.() ?? true);
  const active = visible[Math.min(cursor, Math.max(0, visible.length - 1))];

  useEffect(() => setCursor(0), [query]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/60 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="h-fit w-full max-w-lg rounded-lg border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((c) => Math.min(c + 1, visible.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (event.key === "Enter" && active !== undefined) {
                active.run();
                setOpen(false);
              }
            }}
            placeholder="Type a command… (split, gaps, undo)"
            aria-label="command palette"
          />
        </div>
        <ul className="max-h-64 overflow-y-auto p-1.5">
          {visible.length === 0 && (
            <li className="px-2.5 py-2 text-xs text-faint">No matching command.</li>
          )}
          {visible.map((action, index) => (
            <li key={action.id}>
              <button
                onMouseEnter={() => setCursor(index)}
                onClick={() => {
                  action.run();
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[13px] ${
                  index === Math.min(cursor, Math.max(0, visible.length - 1))
                    ? "bg-[#23262c] text-foreground"
                    : "text-muted"
                }`}
              >
                {action.label}
                {action.hint !== undefined && (
                  <kbd className="rounded border border-border px-1.5 font-mono text-[11px] text-faint">
                    {action.hint}
                  </kbd>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
