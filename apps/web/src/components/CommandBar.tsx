import { useState } from "react";
import { CornerDownLeft, Sparkle } from "lucide-react";
import { HELP, parseCommand } from "../lib/commands";
import { useEditorStore } from "../store";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

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
    <div className={compact ? "w-full" : "w-full max-w-2xl"}>
      <div className="flex items-center gap-2 rounded-[10px] border border-border bg-[#16181d] px-3.5 py-2.5">
        <Sparkle className="size-4 shrink-0 text-muted" aria-hidden />
        <Input
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
          className="border-0 bg-transparent px-0 focus:border-0"
        />
        <Button size="sm" onClick={() => submit(text)} aria-label="run command">
          <CornerDownLeft />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {["close gaps", "split here", "undo"].map((chip) => (
          <Button key={chip} size="sm" variant="outline" className="rounded-full" onClick={() => submit(chip)}>
            {chip}
          </Button>
        ))}
        <span className="text-[11px] text-faint" title={HELP}>
          {feedback === null ? (
            "fixed grammar, no guessing"
          ) : (
            <span className={feedback.ok ? "text-success" : "text-destructive"}>
              {feedback.message}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
