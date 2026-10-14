import { Magnet, Redo2, Scissors, Trash2, Undo2 } from "lucide-react";
import { closeGapsOps } from "../lib/closeGaps";
import { canSplitAtPlayhead, deleteSelected, splitAtPlayhead } from "../lib/actions";
import { useEditorStore, usePlayhead, useSelection } from "../store";
import { formatTime } from "../theme";
import { Button } from "./ui/button";

/** Transport row under the preview: time, edit actions, undo, zoom. */
export function TransportBar() {
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const setZoom = useEditorStore((state) => state.setZoom);
  const pxPerSecond = useEditorStore((state) => state.pxPerSecond);
  const selection = useSelection();
  const playheadMs = usePlayhead();

  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <span className="font-mono text-[13px]">{formatTime(playheadMs)}</span>
      <span className="text-xs text-faint">|</span>
      <Button size="sm" onClick={splitAtPlayhead} disabled={!canSplitAtPlayhead()} title="S">
        <Scissors /> Split
      </Button>
      <Button size="sm" onClick={deleteSelected} disabled={selection === null} title="Delete">
        <Trash2 /> Delete
      </Button>
      <Button size="sm" variant="ghost" onClick={undo} title="Ctrl+Z">
        <Undo2 /> Undo
      </Button>
      <Button size="sm" variant="ghost" onClick={redo} title="Ctrl+Shift+Z">
        <Redo2 /> Redo
      </Button>
      <Button
        size="sm"
        variant="ghost"
        title="Ripple-close every gap on every track"
        onClick={() => {
          const { timeline, dispatch } = useEditorStore.getState();
          for (const op of closeGapsOps(timeline)) dispatch(op);
        }}
      >
        <Magnet /> Close gaps
      </Button>
      <span className="flex-1" />
      {selection !== null && (
        <span className="font-mono text-xs text-muted">{selection}</span>
      )}
      <label className="text-xs text-muted">
        Zoom{" "}
        <input
          type="range"
          min={5}
          max={400}
          value={pxPerSecond}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="align-middle"
        />
      </label>
    </div>
  );
}
