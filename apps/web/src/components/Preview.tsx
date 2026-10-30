import { useEffect, useRef, useState } from "react";
import { Clapperboard, Maximize, Minimize } from "lucide-react";
import { Player } from "./Player";
import { Transport } from "./Transport";
import { useEditorStore } from "../store";

export function Preview() {
  const empty = useEditorStore((state) => Object.keys(state.timeline.clips).length === 0);
  const root = useRef<HTMLElement | null>(null);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  useEffect(() => {
    const changed = (): void => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  const toggleFullscreen = async (): Promise<void> => {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else if (root.current !== null && typeof root.current.requestFullscreen === "function") await root.current.requestFullscreen();
      else throw new Error("Fullscreen is unavailable in this browser");
    } catch (error) {
      setFullscreenError(error instanceof Error ? error.message : "Fullscreen could not be opened");
    }
  };

  return (
    <section ref={root} aria-label="Video preview" className="preview-workspace">
      <div className="preview-heading">
        <h2><span className="monitor-dot" /> Program monitor</h2>
        <div className="preview-view-controls">
          <select aria-label="Preview zoom" value={zoom} onChange={(event) => {
            const value = event.target.value;
            setZoom(value === "fit" ? "fit" : value === "0.5" ? 0.5 : 1);
          }}>
            <option value="fit">Fit to panel</option>
            <option value="1">100%</option>
            <option value="0.5">50%</option>
          </select>
          <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
            {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </div>
      </div>
      <div className="preview-player">
        <Player zoom={zoom} fill />
        {empty && (
          <div className="studio-viewer-empty">
            <Clapperboard size={34} aria-hidden />
            <h3>Your sequence plays here.</h3>
            <p>Cuts, gaps, and audio follow the timeline below.</p>
          </div>
        )}
      </div>
      <div className="preview-transport"><Transport /></div>
      {fullscreenError !== null && <p className="preview-error" role="alert">{fullscreenError}</p>}
    </section>
  );
}
