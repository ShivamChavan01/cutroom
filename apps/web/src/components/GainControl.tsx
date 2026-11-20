import { useEffect, useMemo, useState } from "react";
import { assetById, type Clip } from "@cutroom/engine";
import { audioClip, gainOffer } from "../lib/gainSuggestions";
import { useEditorStore, type GainPreview } from "../store";
import { useUiStore } from "../uiStore";
import { formatTime } from "../theme";
import { Button } from "./ui/button";

const GAIN_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
const percent = (volume: number) => `${Math.round(volume * 100)}%`;

export function GainSuggestion() {
  const timeline = useEditorStore(state => state.timeline);
  const history = useEditorStore(state => state.history);
  const selectedClipId = useEditorStore(state => state.selectedClipId);
  const isPlaying = useEditorStore(state => state.isPlaying);
  const gainSuggestions = useEditorStore(state => state.gainSuggestions);
  const lockedTracks = useUiStore(state => state.lockedTrackIds);
  const offer = useMemo(() => gainOffer({ timeline, history, selectedClipId, isPlaying, gainSuggestions }, lockedTracks),
    [timeline, history, selectedClipId, isPlaying, gainSuggestions, lockedTracks]);
  const [review, setReview] = useState<GainPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (offer !== null) useEditorStore.getState().noteGainSuggestion(offer.key);
  }, [offer?.key]);

  if (offer === null) {
    const feedback = gainSuggestions.feedback.at(-1);
    return feedback?.clipId === selectedClipId && feedback.kind === "applied" && timeline.clips[feedback.clipId]?.volume === feedback.volume
      ? <p className="inspector-hint" role="status">Applied gain match. Undo reverses this edit.</p> : null;
  }
  const reviewed = review !== null && review.offerKey === offer.key && review.proposal.before === timeline
    && review.history === history && review.epoch === gainSuggestions.epoch && review.lockedTracks === lockedTracks;
  const attempt = (action: () => void) => {
    try { action(); setError(null); }
    catch (cause) { setReview(null); setError(cause instanceof Error ? cause.message : "Could not use this gain suggestion."); }
  };
  return <section className="gain-suggestion" aria-label="Suggested gain match">
    <h4>Match gain to {percent(offer.volume)}?</h4>
    <p>Your last three gain edits on this source and track used {percent(offer.volume)}.</p>
    <details><summary>Show supporting edits</summary><ul>{offer.support.map(decision => <li key={decision.id}>
      {decision.clip.id} at {formatTime(decision.clip.start)} · {percent(decision.clip.volume)}
    </li>)}</ul><p>{assetById(timeline, offer.assetId)?.name ?? offer.assetId} · {timeline.tracks.find(track => track.id === offer.trackId)?.name}</p></details>
    {reviewed && <div className="gain-preview" aria-label="Gain match preview">
      <p>{offer.clipId}: {percent(offer.fromVolume)} → {percent(offer.volume)} · one clip</p>
      <p>No edit applied yet. One Undo will reverse the applied change.</p>
      <p>{review.proposal.verification.introduced.length} new structural findings</p>
    </div>}
    {review !== null && !reviewed && <p role="status">Editing context changed. Preview again before applying.</p>}
    <div className="gain-suggestion-actions">
      {reviewed ? <Button type="button" size="sm" onClick={() => attempt(() => useEditorStore.getState().applyGainSuggestion(review))}>Apply gain match</Button>
        : <Button type="button" size="sm" variant="outline" onClick={() => attempt(() => setReview(useEditorStore.getState().previewGainSuggestion(offer.key)))}>Preview gain match</Button>}
      <Button type="button" size="sm" variant="ghost" aria-label="Dismiss gain suggestion" onClick={() => { useEditorStore.getState().dismissGainSuggestion(offer.key); setReview(null); setError(null); }}>Dismiss</Button>
    </div>
    {error !== null && <p className="editor-error" role="alert">{error}</p>}
  </section>;
}

export function GainControl({ clip, disabled, onError }: { clip: Clip; disabled: boolean; onError: (error: string | null) => void }) {
  const enabled = useEditorStore(state => state.gainSuggestions.enabled);
  const timeline = useEditorStore(state => state.timeline);
  const eligible = audioClip(timeline, clip.id) !== undefined;
  useEffect(() => {
    const cancel = () => useEditorStore.getState().cancelGainGesture(clip.id);
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("blur", cancel); cancel(); };
  }, [clip.id]);

  return <>
    <label className="volume-control"><span>Volume</span><input type="range" aria-label="Clip volume" min="0" max="100"
      value={Math.round(clip.volume * 100)} disabled={disabled}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        useEditorStore.getState().beginGainGesture(clip.id);
      }}
      onChange={event => {
        try {
          const store = useEditorStore.getState();
          store.beginGainGesture(clip.id);
          store.changeGain(clip.id, Number(event.target.value) / 100);
          onError(null);
        } catch (cause) { onError(cause instanceof Error ? cause.message : "Could not change clip volume."); }
      }}
      onPointerUp={event => {
        useEditorStore.getState().finishGainGesture(clip.id);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => useEditorStore.getState().cancelGainGesture(clip.id)}
      onLostPointerCapture={() => useEditorStore.getState().cancelGainGesture(clip.id)}
      onBlur={() => useEditorStore.getState().finishGainGesture(clip.id)}
      onKeyDown={event => {
        if (GAIN_KEYS.has(event.key)) useEditorStore.getState().beginGainGesture(clip.id);
        if (event.key === "Escape") { event.preventDefault(); useEditorStore.getState().cancelGainGesture(clip.id); }
      }}
      onKeyUp={event => { if (GAIN_KEYS.has(event.key)) useEditorStore.getState().finishGainGesture(clip.id); }}
    /><output>{percent(clip.volume)}</output></label>
    {eligible && <>
      <label className="gain-suggestions-toggle"><input type="checkbox" checked={enabled}
        onChange={event => useEditorStore.getState().setGainSuggestionsEnabled(event.target.checked)} />Suggest gain matches</label>
      <p className="inspector-hint">Match three clips, then select another from the same source and track. Suggestions use this session's edits.</p>
      <GainSuggestion />
    </>}
  </>;
}
