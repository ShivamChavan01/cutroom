import { assetById, type Clip, type History, type OpEnvelope, type Timeline } from "@cutroom/engine";

export interface GainDecision {
  readonly id: number;
  readonly clip: Clip;
  readonly envelope: OpEnvelope;
}

export interface GainOffer {
  readonly key: string;
  readonly clipId: string;
  readonly assetId: string;
  readonly trackId: string;
  readonly fromVolume: number;
  readonly volume: number;
  readonly support: readonly [GainDecision, GainDecision, GainDecision];
}

interface GainSuppression {
  readonly clipId: string;
  readonly volume: number;
  readonly throughDecision: number;
}

export interface GainFeedback {
  readonly kind: "shown" | "previewed" | "dismissed" | "applied" | "undone";
  readonly offerKey: string;
  readonly clipId: string;
  readonly volume: number;
}

export interface GainSuggestions {
  readonly epoch: number;
  readonly enabled: boolean;
  readonly blocked: boolean;
  readonly nextDecision: number;
  readonly gesture: { readonly clip: Clip; readonly envelope: OpEnvelope | null; readonly lockedTracks: readonly string[] } | null;
  readonly decisions: readonly GainDecision[];
  readonly suppressed: readonly GainSuppression[];
  readonly feedback: readonly GainFeedback[];
  readonly application: { readonly offer: GainOffer; readonly envelope: OpEnvelope } | null;
}

export interface GainContext {
  readonly timeline: Timeline;
  readonly history: History;
  readonly selectedClipId: string | null;
  readonly isPlaying: boolean;
  readonly gainSuggestions: GainSuggestions;
}

export function createGainSuggestions(): GainSuggestions {
  return { epoch: 0, enabled: true, blocked: false, nextDecision: 0, gesture: null, decisions: [], suppressed: [], feedback: [], application: null };
}

export function audioClip(timeline: Timeline, id: string | null): Clip | undefined {
  const clip = id !== null && Object.hasOwn(timeline.clips, id) ? timeline.clips[id] : undefined;
  return clip !== undefined && assetById(timeline, clip.assetId)?.kind === "audio"
    && timeline.tracks.some(track => track.id === clip.trackId && track.kind === "audio") ? clip : undefined;
}

export function gainOffer(context: GainContext, lockedTracks: readonly string[]): GainOffer | null {
  const { timeline, history, gainSuggestions: session } = context;
  if (!session.enabled || session.blocked || session.gesture !== null || context.isPlaying) return null;
  const target = audioClip(timeline, context.selectedClipId);
  if (target === undefined || lockedTracks.includes(target.trackId)) return null;

  // Envelope identity survives Undo/Redo; sequence numbers are reused after Undo and append.
  const latest = new Map<string, OpEnvelope>();
  for (let index = 0; index < history.cursor; index += 1) {
    const envelope = history.log[index];
    if (envelope === undefined) continue;
    const { op } = envelope;
    if ("clipId" in op) latest.set(op.clipId, envelope);
    else if (op.type === "addClip") latest.set(op.clip.id, envelope);
  }
  const distinct = new Map<string, GainDecision>();
  for (const decision of [...session.decisions].reverse()) {
    const clip = audioClip(timeline, decision.clip.id);
    if (clip === undefined || clip.assetId !== target.assetId || clip.trackId !== target.trackId) continue;
    if (latest.get(clip.id) !== decision.envelope || clip.volume !== decision.clip.volume || distinct.has(clip.id)) continue;
    distinct.set(clip.id, decision);
    if (distinct.size === 3) break;
  }
  const [first, second, third] = [...distinct.values()];
  if (first === undefined || second === undefined || third === undefined) return null;
  if (distinct.has(target.id)) return null;
  const volume = first.clip.volume;
  if (second.clip.volume !== volume || third.clip.volume !== volume || target.volume === volume) return null;
  const support = [first, second, third] as const;
  if (session.suppressed.some(entry => entry.clipId === target.id && entry.volume === volume
    && support.every(decision => decision.id <= entry.throughDecision))) return null;
  return {
    key: JSON.stringify([target.id, volume, ...support.map(decision => decision.id)]),
    clipId: target.id, assetId: target.assetId, trackId: target.trackId,
    fromVolume: target.volume, volume, support,
  };
}

export function gainFeedback(session: GainSuggestions, kind: GainFeedback["kind"], offer: GainOffer): GainSuggestions {
  if (kind === "shown" && session.feedback.some(event => event.kind === kind && event.offerKey === offer.key)) return session;
  return { ...session, feedback: [...session.feedback, { kind, offerKey: offer.key, clipId: offer.clipId, volume: offer.volume }].slice(-64) };
}

export function suppressGainOffer(session: GainSuggestions, offer: GainOffer): GainSuggestions {
  const entry = { clipId: offer.clipId, volume: offer.volume, throughDecision: session.nextDecision };
  return { ...session, suppressed: [...session.suppressed.filter(item => item.clipId !== entry.clipId || item.volume !== entry.volume), entry].slice(-32) };
}
