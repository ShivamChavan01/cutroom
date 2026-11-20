import { useEffect, useState } from "react";
import { useEditorStore } from "../store";

export function ProjectSettings() {
  const timeline = useEditorStore((state) => state.timeline);
  const dispatch = useEditorStore((state) => state.dispatch);
  const [name, setName] = useState(timeline.id);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(timeline.id), [timeline.id]);

  return (
    <section className="project-settings" aria-label="Project settings">
      <h2>Project settings</h2>
      <label>Project name<input aria-label="Project name" value={name} onChange={(event) => setName(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
        onBlur={() => {
        if (name.trim() === timeline.id) { setName(timeline.id); setError(null); return; }
        try { dispatch({ type: "renameProject", name: name.trim() }); setError(null); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rename project."); }
      }} /></label>
      <label>Timeline frame rate<select aria-label="Timeline frame rate" value={timeline.fps ?? 30} onChange={(event) => {
        try { dispatch({ type: "setFrameRate", fps: Number(event.target.value) }); setError(null); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change frame rate."); }
      }}>{[24,25,30,50,60].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}</select></label>
      <p>Frame rate controls timeline timecode and interchange exports.</p>
      <p>Changes save automatically in this browser.</p>
      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
}
