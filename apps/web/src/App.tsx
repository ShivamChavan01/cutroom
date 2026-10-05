import { useEffect } from "react";
import { emptyTimeline, makeClip, putAsset } from "@cutroom/engine";
import { Timeline } from "./components/Timeline";
import { Player } from "./components/Player";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { ActivityFeed } from "./components/ActivityFeed";
import { UploadButton } from "./components/UploadButton";
import { VersionControl } from "./components/VersionControl";
import { registerAssetUrl } from "./lib/assets";
import { useEditorStore, useSelection } from "./store";

/**
 * Temporary seeding. Clips alternate between two assets so the §4
 * checkpoint (src swap at a boundary) is exercised on every crossing.
 * Drop two short mp4s at apps/web/public/test-a.mp4 and test-b.mp4
 * (gitignored, dev-only) to run the checkpoint with real media.
 */
function seedTestClips() {
  const { dispatch, loadTimeline } = useEditorStore.getState();
  let base = emptyTimeline("demo");
  base = putAsset(base, { id: "asset-a", kind: "video", duration: 60_000 });
  base = putAsset(base, { id: "asset-b", kind: "video", duration: 60_000 });
  loadTimeline(base);
  registerAssetUrl("asset-a", "/test-a.mp4");
  registerAssetUrl("asset-b", "/test-b.mp4");
  const clips = [
    { id: "a", start: 0, duration: 4_000, assetId: "asset-a" },
    { id: "b", start: 4_000, duration: 3_000, assetId: "asset-b" },
    { id: "c", start: 9_000, duration: 5_000, assetId: "asset-a" },
    { id: "narr", start: 1_000, duration: 6_000, assetId: "asset-a", trackId: "a1" },
  ];
  for (const { id, start, duration, assetId, trackId } of clips) {
    dispatch({
      type: "addClip",
      clip: makeClip({
        id,
        trackId: trackId ?? "v1",
        assetId,
        start,
        inPoint: 0,
        duration,
        volume: 1,
      }),
    });
  }
}

/** Dev-only §6 checkpoint: force an overlap the linter must flag. */
function seedOverlap() {
  const { dispatch } = useEditorStore.getState();
  dispatch({
    type: "addClip",
    clip: makeClip({
      id: "overlap-demo",
      trackId: "v1",
      assetId: "asset-a",
      start: 2_000,
      inPoint: 0,
      duration: 2_000,
      volume: 1,
    }),
  });
}

function splitAtPlayhead() {
  const { timeline, selectedClipId, playheadMs, dispatch } =
    useEditorStore.getState();
  if (selectedClipId === null) return;
  const clip = timeline.clips[selectedClipId];
  if (clip === undefined) return;
  // Engine op takes a clip-local offset; the UI thinks in timeline time.
  const at = playheadMs - clip.start;
  if (at <= 0 || at >= clip.duration) return;
  dispatch({ type: "splitClip", clipId: selectedClipId, at });
}

function deleteSelected() {
  const { selectedClipId, dispatch, selectClip } = useEditorStore.getState();
  if (selectedClipId === null) return;
  dispatch({ type: "deleteClip", clipId: selectedClipId });
  selectClip(null);
}

function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return (
    target !== null &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

export function App() {
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const playheadMs = useEditorStore((state) => state.playheadMs);
  const setZoom = useEditorStore((state) => state.setZoom);
  const pxPerSecond = useEditorStore((state) => state.pxPerSecond);
  const selection = useSelection();
  const timeline = useEditorStore((state) => state.timeline);

  const selectedClip =
    selection !== null ? timeline.clips[selection] : undefined;
  const canSplit =
    selectedClip !== undefined &&
    playheadMs > selectedClip.start &&
    playheadMs < selectedClip.start + selectedClip.duration;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        useEditorStore.getState().redo();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
      } else if (event.key.toLowerCase() === "s") {
        splitAtPlayhead();
      } else if (event.key === " ") {
        const target = event.target as HTMLElement | null;
        if (target !== null && target.tagName === "BUTTON") return;
        event.preventDefault();
        const store = useEditorStore.getState();
        if (store.isPlaying) store.pause();
        else store.play();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: 24,
        background: "#0b0c0e",
        color: "#e9ecef",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <h1 style={{ margin: "0 0 12px" }}>Cutroom</h1>
      <Player />
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={seedTestClips}>Add test clips</button>
        <UploadButton />
        <button onClick={seedOverlap}>Add overlapping clip (§6 demo)</button>
        <button onClick={splitAtPlayhead} disabled={!canSplit} title="S">
          Split at playhead
        </button>
        <button
          onClick={deleteSelected}
          disabled={selection === null}
          title="Delete"
        >
          Delete selected
        </button>
        <button onClick={undo}>Undo</button>
        <button onClick={redo}>Redo</button>
        <label style={{ fontSize: 12 }}>
          Zoom{" "}
          <input
            type="range"
            min={5}
            max={400}
            value={pxPerSecond}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <span style={{ fontSize: 12, color: "#868e96" }}>
          playhead {(playheadMs / 1000).toFixed(2)}s
          {selection !== null ? ` · selected ${selection}` : ""}
        </span>
      </div>
      <Timeline />
      <DiagnosticsPanel />
      <ActivityFeed />
      <VersionControl />
      <p style={{ fontSize: 11, color: "#495057", marginTop: 12 }}>
        Shortcuts: S split · Delete remove · Space play/pause · Ctrl+Z / Ctrl+Shift+Z undo/redo.
        Drag clip edges to trim (one op on release).
      </p>
    </main>
  );
}
