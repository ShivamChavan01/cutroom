import { useEffect, useMemo, useState } from "react";
import { authorsByClip, lint, timelineDuration } from "@cutroom/engine";
import { Link2, MousePointer2, RotateCcw, Scissors, Trash2 } from "lucide-react";
import { authorColor } from "../lib/identity";
import { deleteSelected, splitAtPlayhead } from "../lib/actions";
import { clipPropertyOp, type ClipProperty } from "../lib/clipProperties";
import { useEditorStore, useSelection } from "../store";
import { useUiStore } from "../uiStore";
import { formatTime } from "../theme";
import { Button } from "./ui/button";
import { MediaPoster } from "./MediaPoster";
import { ProjectSettings } from "./ProjectSettings";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";

function Row({ label, value }: { label: string; value: string }) {
  return <div className="inspector-property"><dt>{label}</dt><dd title={value}>{value}</dd></div>;
}

function NumericProperty({ label, value, disabled, title, onCommit }: {
  label: string; value: number; disabled: boolean; title?: string; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className="inspector-number"><span>{label}</span><input type="number" aria-label={label} title={title} value={draft} disabled={disabled} step="any"
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { if (draft.trim() === "") { setDraft(String(value)); return; } onCommit(Number(draft)); }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}

export function Inspector() {
  const timeline = useEditorStore((state) => state.timeline);
  const history = useEditorStore((state) => state.history);
  const playheadMs = useEditorStore((state) => state.playheadMs);
  const dispatch = useEditorStore((state) => state.dispatch);
  const selection = useSelection();
  const lockedTracks = useUiStore((state) => state.lockedTrackIds);
  const clip = selection === null ? undefined : timeline.clips[selection];
  const asset = clip === undefined ? undefined : timeline.assets[clip.assetId];
  const locked = clip !== undefined && lockedTracks.includes(clip.trackId);
  const canSplit = clip !== undefined && !locked && playheadMs > clip.start && playheadMs < clip.start + clip.duration;
  const tab = useUiStore((state) => state.inspectorTab);
  const setTab = useUiStore((state) => state.setInspectorTab);
  const [linked, setLinked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const authors = useMemo(() => authorsByClip(history, timeline), [history, timeline]);
  const author = clip === undefined ? undefined : authors.get(clip.id);
  const issues = useMemo(() => selection === null ? [] : lint(timeline).filter((issue) => issue.clipIds.includes(selection)), [timeline, selection]);
  const edit = (field: ClipProperty, value: number) => {
    if (clip === undefined || locked) return;
    try { dispatch(clipPropertyOp(clip, field, value, linked)); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not edit clip."); }
  };

  return <Tabs value={tab} onValueChange={(value) => { if (value === "clip" || value === "sequence" || value === "project") setTab(value); }} className="studio-inspector" data-testid="inspector">
    <TabsList variant="line" aria-label="Inspector views">
      {(["clip", "sequence", "project"] as const).map((id) => <TabsTrigger key={id} value={id}>{id[0]?.toUpperCase()}{id.slice(1)}</TabsTrigger>)}
    </TabsList>
    <TabsContent value={tab}>
    {tab === "project" ? <ProjectSettings /> : tab === "sequence" ? <section className="inspector-section"><h2>Sequence</h2><dl><Row label="Duration" value={formatTime(timelineDuration(timeline))} /><Row label="Frame rate" value={`${timeline.fps ?? 30} fps`} /><Row label="Clips" value={String(Object.keys(timeline.clips).length)} /></dl>{timeline.tracks.map((track) => <div className="inspector-property" key={track.id}><span>{track.name}</span><span>{track.kind}</span></div>)}</section> : <>
      <header className="inspector-heading"><h2>Clip properties</h2></header>
      {clip === undefined ? <div className="inspector-empty"><MousePointer2 size={24} aria-hidden /><h3>No clip selected</h3><p>Select a clip in the timeline to inspect and edit its properties.</p></div> : <>
        <div className="inspector-media"><MediaPoster assetId={clip.assetId} /><div><h3 title={asset?.name ?? clip.id}>{asset?.name ?? clip.id}</h3><span>{asset?.width !== undefined && asset.height !== undefined ? `${asset.width} × ${asset.height} · ` : ""}{asset?.mimeType ?? asset?.kind ?? "media"}</span><div className="inspector-author"><span className="inspector-author-dot" style={{background: authorColor(author ?? "unknown")}} />{author ?? "Unknown author"}</div></div></div>
        <section className="inspector-section" aria-label="Clip transform"><h3 className="inspector-section-title">Transform<button type="button" aria-label="Reset transform" disabled={locked} onClick={() => { try { dispatch({ type: "setTransform", clipId: clip.id, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reset transform."); } }}><RotateCcw size={13} /></button></h3>
          <div className="property-pair"><NumericProperty label="Position X" value={clip.x ?? 0} disabled={locked} onCommit={(value) => edit("x", value)} /><NumericProperty label="Position Y" value={clip.y ?? 0} disabled={locked} onCommit={(value) => edit("y", value)} /></div>
          <div className="property-pair"><NumericProperty label="Scale X %" value={(clip.scaleX ?? 1) * 100} disabled={locked} onCommit={(value) => edit("scaleX", value)} /><NumericProperty label="Scale Y %" value={(clip.scaleY ?? 1) * 100} disabled={locked} onCommit={(value) => edit("scaleY", value)} /><button type="button" className="scale-link" aria-label="Link scale" aria-pressed={linked} onClick={() => setLinked(!linked)}><Link2 size={14} /></button></div>
          <NumericProperty label="Rotation" value={clip.rotation ?? 0} disabled={locked} onCommit={(value) => edit("rotation", value)} />
        </section>
        <section className="inspector-section" aria-label="Clip timing"><h3 className="inspector-section-title">Timing</h3><NumericProperty label="Clip start seconds" title={formatTime(clip.start)} value={clip.start / 1000} disabled={locked} onCommit={(value) => edit("start", value)} /><NumericProperty label="In point seconds" title={formatTime(clip.inPoint)} value={clip.inPoint / 1000} disabled={locked} onCommit={(value) => edit("inPoint", value)} /><NumericProperty label="Out point seconds" title={formatTime(clip.outPoint)} value={clip.outPoint / 1000} disabled={locked} onCommit={(value) => edit("outPoint", value)} /><dl><Row label="Duration" value={formatTime(clip.duration)} /></dl><label className="inspector-number"><span>Track</span><select aria-label="Clip track" value={clip.trackId} disabled={locked} onChange={(event) => { try { dispatch({type: "moveClip", clipId:clip.id, start:clip.start, trackId:event.target.value}); setError(null); } catch(reason) { setError(reason instanceof Error ? reason.message : "Could not move clip."); } }}>{timeline.tracks.filter((track) => asset?.kind === "audio" ? track.kind === "audio" : track.kind === "video").map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label></section>
        <section className="inspector-section" aria-label="Clip audio"><h3 className="inspector-section-title">Audio</h3><label className="volume-control"><span>Volume</span><input type="range" aria-label="Clip volume" min="0" max="100" value={Math.round(clip.volume * 100)} disabled={locked} onChange={(event) => edit("volume",Number(event.target.value))} /><output>{Math.round(clip.volume * 100)}%</output></label></section>
        <section className="inspector-section" aria-label="Source media"><h3 className="inspector-section-title">Source</h3><dl><Row label="Asset" value={clip.assetId.slice(0, 12)} /></dl></section>
        <div className="inspector-actions"><Button size="sm" onClick={splitAtPlayhead} disabled={!canSplit} title="Split at playhead (S)"><Scissors /> Split at playhead</Button><Button size="sm" variant="destructive" disabled={locked} onClick={deleteSelected} title="Delete selected clip"><Trash2 /> Delete</Button></div>
        {!canSplit && <p className="inspector-hint">Place the playhead inside this clip to split.</p>}
        {locked && <p className="inspector-hint">This track is locked. Unlock it to edit.</p>}
        {issues.length > 0 && <section className="inspector-section" aria-label="Clip issues"><h3 className="inspector-section-title">Issues</h3>{issues.map((issue,index) => <p key={`${issue.key}-${index}`} className={`inspector-issue inspector-issue-${issue.severity}`}>{issue.message}</p>)}</section>}
      </>}
    </>}
    {error !== null && <p className="editor-error" role="alert">{error}</p>}
    </TabsContent>
  </Tabs>;
}
