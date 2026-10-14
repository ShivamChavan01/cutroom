import { canSplitAtPlayhead, deleteSelected, splitAtPlayhead } from "../lib/actions";
import { useEditorStore, usePlayhead, useSelection } from "../store";
import { formatTime, theme } from "../theme";

/** Transport row under the preview: time, edit actions, undo, zoom. */
export function TransportBar() {
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const setZoom = useEditorStore((state) => state.setZoom);
  const pxPerSecond = useEditorStore((state) => state.pxPerSecond);
  const selection = useSelection();
  const playheadMs = usePlayhead();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
        {formatTime(playheadMs)}
      </span>
      <span style={{ color: theme.faint, fontSize: 12 }}>|</span>
      <button onClick={splitAtPlayhead} disabled={!canSplitAtPlayhead()} title="S">
        Split
      </button>
      <button onClick={deleteSelected} disabled={selection === null} title="Delete">
        Delete
      </button>
      <button onClick={undo} title="Ctrl+Z">Undo</button>
      <button onClick={redo} title="Ctrl+Shift+Z">Redo</button>
      <span style={{ flex: 1 }} />
      {selection !== null && (
        <span style={{ fontSize: 12, color: theme.dim }}>{selection}</span>
      )}
      <label style={{ fontSize: 12, color: theme.dim }}>
        Zoom{" "}
        <input
          type="range"
          min={5}
          max={400}
          value={pxPerSecond}
          onChange={(event) => setZoom(Number(event.target.value))}
          style={{ verticalAlign: "middle" }}
        />
      </label>
    </div>
  );
}
