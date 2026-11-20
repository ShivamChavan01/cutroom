import { useEffect, useMemo, useRef, useState } from "react";
import { assetById } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { useProductionStore } from "../productionStore";
import { reviewProduction } from "../lib/production/review";
import { nextProductionId, productionDraft, saveProductionDraft } from "../lib/production/form";
import { buildProductionContext } from "../lib/production/context";
import { assistantScopeIsCurrent, captureAssistantScope } from "../lib/assistant/scope";
import { Button } from "./ui/button";
import { formatTime } from "../theme";

export function ProductionContextPanel({ onDraftChange, onSaved, query = "Review the production brief, style and continuity" }: { onDraftChange?: (dirty: boolean) => void; onSaved?: () => void; query?: string }) {
  const document = useProductionStore(state => state.document);
  const timeline = useEditorStore(state => state.timeline);
  const selection = useEditorStore(state => state.selectedClipId);
  const clip = selection !== null && Object.hasOwn(timeline.clips, selection) ? timeline.clips[selection] : undefined;
  const asset = clip === undefined ? undefined : assetById(timeline, clip.assetId);
  const [brief, setBrief] = useState(productionDraft(document).brief);
  const [style, setStyle] = useState(productionDraft(document).style);
  const [continuity, setContinuity] = useState(productionDraft(document).continuity);
  const [seconds, setSeconds] = useState(productionDraft(document).seconds);
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<{ packet: ReturnType<typeof buildProductionContext>; scope: ReturnType<typeof captureAssistantScope>; query: string } | null>(null);
  const inspectionPositionChanged = useEditorStore(state => inspection !== null && state.playheadMs !== inspection.scope.playheadMs);
  const importRevision = useRef(0);
  const saved = productionDraft(document);
  const dirty = brief !== saved.brief || style !== saved.style || continuity !== saved.continuity || seconds !== saved.seconds;
  useEffect(() => { onDraftChange?.(dirty); }, [dirty, onDraftChange]);
  useEffect(() => {
    const next = productionDraft(document);
    setBrief(next.brief); setStyle(next.style); setContinuity(next.continuity); setSeconds(next.seconds); setInspection(null); setError(null);
  }, [document]);
  useEffect(() => () => { importRevision.current += 1; }, []);
  const checks = useMemo(() => document === null ? [] : reviewProduction(timeline, document), [timeline, document]);
  const attempt = (action: () => void) => {
    try { action(); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update production context."); }
  };
  const save = () => attempt(() => {
    importRevision.current += 1;
    useProductionStore.getState().install(saveProductionDraft(document, { brief, style, continuity, seconds }));
    onSaved?.();
  });
  const protect = (channel: "video" | "audio") => attempt(() => {
    if (document === null || clip === undefined) throw new Error("Save a production brief and select a clip first.");
    useProductionStore.getState().install({ ...document, requirements: [...document.requirements, {
      id: nextProductionId("preserve", document), label: `Preserve ${clip.id} ${channel} range`, priority: "required", kind: "preserve",
      range: { assetId: clip.assetId, channel, inMs: clip.inPoint, outMs: clip.outPoint },
    }] });
  });
  return <section className="production-context-panel" aria-label="Production context">
    <div className="production-editor-heading"><h3>Production brief & continuity</h3><Button type="button" size="sm" onClick={save} disabled={!brief.trim() || !dirty}>Save production brief</Button></div>
    <div className="production-editor-scroll">
    <p>Give the assistant the intended story, reference direction and requirements that edits must preserve.</p>
    <label>Production brief<textarea aria-label="Production brief" value={brief} maxLength={12_000} rows={3} placeholder="Audience, story, deliverable and required content" onChange={event => { importRevision.current += 1; setBrief(event.target.value); }} /></label>
    <details><summary>Add direction or requirements</summary>
      <label>Reference style direction<textarea aria-label="Reference style direction" value={style} maxLength={4000} rows={2} placeholder="Describe the reference and which qualities to follow" onChange={event => { importRevision.current += 1; setStyle(event.target.value); }} /></label>
      <label>Continuity requirement<textarea aria-label="Continuity requirement" value={continuity} maxLength={4000} rows={2} placeholder="What must remain consistent? These judgments need human review." onChange={event => { importRevision.current += 1; setContinuity(event.target.value); }} /></label>
      <label>Maximum duration in seconds<input type="number" aria-label="Maximum production duration seconds" min="0.001" step="any" value={seconds} onChange={event => { importRevision.current += 1; setSeconds(event.target.value); }} /></label>
    </details>
    {document !== null && <>
      <div className="assistant-actions">
        <Button type="button" size="sm" variant="outline" disabled={dirty || clip === undefined || asset === undefined || asset.kind === "audio"} onClick={() => protect("video")}>Protect selected picture</Button>
        <Button type="button" size="sm" variant="outline" disabled={dirty || clip === undefined || asset === undefined || asset.kind === "image"} onClick={() => protect("audio")}>Protect selected audio</Button>
      </div>
      <p>{document.evidence.length} user-provided evidence notes · {document.styleReferences.length} reference directions</p>
      {document.styleReferences.length > 0 && <details><summary>Reference directions need review</summary>{document.styleReferences.map(reference => <p key={reference.id}>{reference.label}: {reference.direction}</p>)}</details>}
      <ul className="production-checks">{checks.map(check => <li key={check.id} data-production-status={check.status}>
        <strong>{check.label}</strong><span>{check.status === "pass" ? "Placement check passed" : check.status === "fail" ? "Requirement violated" : "Human review needed"}</span><p>{check.message}</p>
        <button type="button" disabled={dirty} onClick={() => attempt(() => useProductionStore.getState().install({ ...document, requirements: document.requirements.filter(entry => entry.id !== check.id) }))} aria-label={`Remove requirement ${check.label}`}>Remove requirement</button>
      </li>)}</ul>
      <p className="assistant-disclosure">Placement checks do not verify rendered quality, preview mute/hide preferences, style matching or visual continuity.</p>
      <Button type="button" size="sm" variant="outline" disabled={dirty} onClick={() => attempt(() => {
        const scope = captureAssistantScope();
        setInspection({ packet: buildProductionContext({ document, timeline: scope.timeline, query, selectedClipId: scope.selectedClipId,
          playheadMs: scope.playheadMs, lockedTrackIds: scope.lockedTrackIds }), scope, query });
      })}>Inspect request context</Button>
      {inspection !== null && (inspection.query !== query || inspectionPositionChanged || !assistantScopeIsCurrent(inspection.scope) ? <p role="status">Context changed. Inspect again to see current evidence.</p> : <details open aria-label="Retrieved production evidence">
        <summary>Evidence for this request</summary>
        <p>{inspection.packet.clips.length} clip records included; {inspection.packet.coverage.omittedClips} omitted. {inspection.packet.coverage.includedEvidence} source notes included; {inspection.packet.coverage.omittedEvidence} omitted.</p>
        <p>The complete saved brief, requirements and reference directions are included.</p>
        {inspection.packet.evidence.map(entry => <p key={entry.fact.id}><strong>{entry.fact.id}</strong> · {assetById(timeline, entry.fact.range.assetId)?.name ?? entry.fact.range.assetId} · source {formatTime(entry.fact.range.inMs)}–{formatTime(entry.fact.range.outMs)}. {entry.fact.text} {entry.placementCount} timeline placements.</p>)}
      </details>)}
    </>}
    <details><summary>Import or export source evidence</summary>
      <p>Import authored transcript, shot and continuity notes with source IDs and time ranges. No automatic footage analysis runs here.</p>
      <label>Import production context<input type="file" aria-label="Import production context" accept="application/json,.json" onChange={event => {
        const file = event.target.files?.[0]; if (file === undefined) return;
        const revision = ++importRevision.current, session = useEditorStore.getState().sessionId, contextRevision = useProductionStore.getState().revision;
        void (async () => {
          try {
            if (file.size > 8_000_000) throw new Error("Production context file is too large.");
            const raw = await file.text();
            if (revision !== importRevision.current || session !== useEditorStore.getState().sessionId || contextRevision !== useProductionStore.getState().revision) throw new Error("Context import canceled because the project or brief changed.");
            useProductionStore.getState().install(raw); setError(null);
          } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import production context."); }
        })(); event.target.value = "";
      }} /></label>
      {document !== null && <Button type="button" size="sm" variant="outline" onClick={() => attempt(() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
        try { const link = window.document.createElement("a"); link.href = url; link.download = "cutroom-production-context.json"; link.click(); }
        finally { URL.revokeObjectURL(url); }
      })}>Export production context</Button>}
    </details>
    </div>
    {error !== null && <p className="editor-error" role="alert">{error}</p>}
  </section>;
}
