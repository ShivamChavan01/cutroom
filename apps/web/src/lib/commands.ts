import { type Op, type Timeline } from "@cutroom/engine";
import { closeGapsOps } from "./closeGaps";
import { useEditorStore } from "../store";

/**
 * Deterministic command parser behind the prompt bar. No model, no
 * guessing: regexes over a fixed grammar, every command compiling to
 * engine ops (or store transport). Anything unparseable errors inline
 * with the grammar, never silently.
 *
 * Grammar (case-insensitive, `12s` / `1:30` / `2500ms` times):
 *   split [here | at <t>]   delete [selected | <id>]   play   pause
 *   goto <t>   undo   redo   close gaps   zoom in|out   help
 */
export interface CommandContext {
  readonly timeline: Timeline;
  readonly selectedClipId: string | null;
  readonly playheadMs: number;
}

export type CommandResult =
  | { readonly ok: true; readonly message: string; readonly run: () => void }
  | { readonly ok: false; readonly message: string };

export const HELP =
  "split [at 2s] · delete [id] · play · pause · goto 12s · undo · redo · close gaps · zoom in|out";

function parseTime(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  const ms = text.match(/^(\d+(?:\.\d+)?)\s*ms$/);
  if (ms !== null) return Number(ms[1]);
  const sec = text.match(/^(\d+(?:\.\d+)?)\s*s$/);
  if (sec !== null) return Number(sec[1]) * 1000;
  const clock = text.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (clock !== null) return (Number(clock[1]) * 60 + Number(clock[2])) * 1000;
  const bare = text.match(/^(\d+(?:\.\d+)?)$/);
  if (bare !== null) return Number(bare[1]) * 1000;
  return null;
}

function dispatchAll(ops: readonly Op[]): void {
  const { dispatch } = useEditorStore.getState();
  for (const op of ops) dispatch(op);
}

export function parseCommand(raw: string, ctx: CommandContext): CommandResult {
  const input = raw.trim().toLowerCase();
  if (input === "") return { ok: false, message: HELP };
  if (input === "help") return { ok: true, message: HELP, run: () => undefined };

  if (input === "play") {
    return { ok: true, message: "playing", run: () => useEditorStore.getState().play() };
  }
  if (input === "pause") {
    return { ok: true, message: "paused", run: () => useEditorStore.getState().pause() };
  }
  if (input === "undo") {
    return { ok: true, message: "undone", run: () => useEditorStore.getState().undo() };
  }
  if (input === "redo") {
    return { ok: true, message: "redone", run: () => useEditorStore.getState().redo() };
  }
  if (input === "close gaps") {
    const ops = closeGapsOps(ctx.timeline);
    if (ops.length === 0) return { ok: true, message: "no gaps", run: () => undefined };
    return {
      ok: true,
      message: `closing ${ops.length} gap${ops.length === 1 ? "" : "s"}`,
      run: () => dispatchAll(ops),
    };
  }

  const zoom = input.match(/^zoom\s+(in|out)$/);
  if (zoom !== null) {
    return {
      ok: true,
      message: zoom[1] === "in" ? "zoomed in" : "zoomed out",
      run: () => {
        const store = useEditorStore.getState();
        const current = useEditorStore.getState().pxPerSecond;
        store.setZoom(zoom[1] === "in" ? current * 1.5 : current / 1.5);
      },
    };
  }

  const go = input.match(/^go(?:\s*to)?\s+(.+)$/);
  if (go !== null) {
    const ms = parseTime(go[1]!);
    if (ms === null || ms < 0) return { ok: false, message: `can't parse time "${go[1]}". ${HELP}` };
    return {
      ok: true,
      message: `playhead → ${(ms / 1000).toFixed(1)}s`,
      run: () => useEditorStore.getState().setPlayhead(ms),
    };
  }

  const split = input.match(/^split(?:\s+(?:here|at\s+(.+)))?$/);
  if (split !== null) {
    if (ctx.selectedClipId === null) {
      return { ok: false, message: "split needs a selected clip" };
    }
    const clip = ctx.timeline.clips[ctx.selectedClipId];
    if (clip === undefined) return { ok: false, message: "selected clip is gone" };
    const atRaw = split[1];
    const at =
      atRaw === undefined ? ctx.playheadMs - clip.start : (() => {
        const ms = parseTime(atRaw);
        return ms === null ? null : ms - clip.start;
      })();
    if (at === null) return { ok: false, message: `can't parse time "${atRaw}". ${HELP}` };
    if (at <= 0 || at >= clip.duration) {
      return { ok: false, message: "split point is outside the selected clip" };
    }
    const clipId = ctx.selectedClipId;
    return {
      ok: true,
      message: `split ${clipId}`,
      run: () => dispatchAll([{ type: "splitClip", clipId, at }]),
    };
  }

  const del = input.match(/^delete(?:\s+(.+))?$/);
  if (del !== null) {
    const id = del[1]?.trim() || ctx.selectedClipId;
    if (id === null || id === undefined || id === "") {
      return { ok: false, message: "delete needs a clip id or a selection" };
    }
    if (ctx.timeline.clips[id] === undefined) {
      return { ok: false, message: `no clip "${id}"` };
    }
    return {
      ok: true,
      message: `deleted ${id}`,
      run: () => {
        dispatchAll([{ type: "deleteClip", clipId: id }]);
        useEditorStore.getState().selectClip(null);
      },
    };
  }

  return { ok: false, message: `don't understand "${raw.trim()}". ${HELP}` };
}
