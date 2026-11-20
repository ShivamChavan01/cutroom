import { assetById, timelineDuration, type Clip, type Timeline } from "@cutroom/engine";
import type { ProductionDocument, ProductionEvidence, SourceRange } from "./document";
import { reviewProduction, sourcePlacements } from "./review";

const STOP_WORDS = new Set(["the", "and", "for", "with", "this", "that", "from", "into", "then", "must", "have", "your", "what"]);
function terms(text: string): readonly string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter(term => term.length > 2 && !STOP_WORDS.has(term));
}
function matches(text: string, query: readonly string[]): number {
  const present = new Set(terms(text));
  return query.filter(term => present.has(term)).length;
}
function intersects(a: SourceRange, b: SourceRange): boolean {
  return a.assetId === b.assetId && a.channel === b.channel && a.inMs < b.outMs && b.inMs < a.outMs;
}

export function buildProductionContext(input: {
  readonly document: ProductionDocument;
  readonly timeline: Timeline;
  readonly query: string;
  readonly selectedClipId: string | null;
  readonly playheadMs: number;
  readonly lockedTrackIds: readonly string[];
  readonly maxChars?: number;
}) {
  const { document, timeline } = input, budget = input.maxChars ?? 60_000;
  if (!Number.isSafeInteger(budget) || budget < 2000 || budget > 240_000) throw new Error("Production context budget must be 2,000–240,000 characters.");
  const clips = Object.values(timeline.clips);
  const selected = input.selectedClipId !== null && Object.hasOwn(timeline.clips, input.selectedClipId) ? timeline.clips[input.selectedClipId] : undefined;
  const requiredRanges = document.requirements.flatMap(requirement => requirement.kind === "preserve" ? [requirement.range] : requirement.kind === "sequence" ? requirement.ranges : []);
  const pinnedIds = new Set([...document.styleReferences.flatMap(style => style.evidenceIds), ...document.requirements.flatMap(requirement => requirement.kind === "editorial" ? requirement.evidenceIds : [])]);
  const query = terms(input.query), brief = terms(document.brief);
  const ranked = document.evidence.map((entry, position) => {
    const selectedRange = selected === undefined ? null : { assetId: selected.assetId, channel: entry.range.channel, inMs: selected.inPoint, outMs: selected.outPoint };
    const score = matches(entry.text, query) * 20 + matches(entry.text, brief)
      + (requiredRanges.some(range => intersects(range, entry.range)) ? 100 : 0)
      + (selectedRange !== null && intersects(selectedRange, entry.range) ? 50 : 0);
    return { entry, score, position };
  }).filter(item => item.score > 0 || pinnedIds.has(item.entry.id))
    .sort((a, b) => Number(pinnedIds.has(b.entry.id)) - Number(pinnedIds.has(a.entry.id)) || b.score - a.score || a.position - b.position);
  const checks = reviewProduction(timeline, document);
  const selectedClips: Clip[] = [];
  const selectedAssets: { id: string; name: string | undefined; kind: string; duration: number }[] = [];
  const selectedEvidence: { fact: ProductionEvidence; placements: ReturnType<typeof sourcePlacements>; placementCount: number }[] = [];
  const context = {
    kind: "production-context", version: 1,
    brief: document.brief,
    styleReferences: document.styleReferences,
    requirements: document.requirements,
    checks: checks.map(check => ({ ...check, clipCount: check.clipIds.length, clipIds: check.clipIds.slice(0, 12) })),
    scope: { timelineId: timeline.id, selectedClipId: input.selectedClipId, playheadMs: input.playheadMs, lockedTrackIds: input.lockedTrackIds },
    timeline: { durationMs: timelineDuration(timeline), clipCount: clips.length, tracks: timeline.tracks },
    clips: selectedClips,
    assets: selectedAssets,
    evidence: selectedEvidence,
    coverage: { availableEvidence: document.evidence.length, includedEvidence: 0, omittedEvidence: document.evidence.length, omittedClips: clips.length,
      retrieval: "Lexical and source-range retrieval. Evidence is user-provided; no automatic video or audio understanding.",
      reviewLimit: "Placement checks do not verify rendered quality, source availability, preview mute/hide preferences, style matching or visual continuity." },
  };
  const fits = () => JSON.stringify(context).length <= budget - 512;
  if (!fits()) throw new Error("The production brief and constraints exceed the context budget. They cannot be silently truncated.");
  const addClip = (clip: Clip) => {
    if (context.clips.some(entry => entry.id === clip.id)) return true;
    const asset = assetById(timeline, clip.assetId);
    const newAsset = asset !== undefined && !context.assets.some(entry => entry.id === asset.id);
    context.clips.push(clip);
    if (newAsset) context.assets.push({ id: asset.id, name: asset.name, kind: asset.kind, duration: asset.duration });
    if (fits()) return true;
    context.clips.pop(); if (newAsset) context.assets.pop();
    return false;
  };
  if (selected !== undefined && !addClip(selected)) throw new Error("The selected clip cannot fit alongside the production constraints.");
  for (const check of checks) {
    for (const id of check.clipIds.slice(0, 12)) {
      const clip = Object.hasOwn(timeline.clips, id) ? timeline.clips[id] : undefined;
      if (clip !== undefined && context.clips.length < 60) addClip(clip);
    }
  }
  const included = new Set<string>();
  for (const { entry } of ranked) {
    const placements = sourcePlacements(timeline, entry.range);
    context.evidence.push({ fact: entry, placements: placements.slice(0, 4), placementCount: placements.length });
    if (!fits()) {
      context.evidence.pop();
      if (pinnedIds.has(entry.id)) throw new Error("Referenced production evidence exceeds the context budget. Increase the budget or shorten the source notes.");
      break;
    }
    included.add(entry.id);
    if (included.size >= 60 && [...pinnedIds].every(id => included.has(id))) break;
  }
  const supportIds = new Set(checks.flatMap(check => check.clipIds));
  const nearby = selected?.start ?? input.playheadMs;
  const rankedClips = clips.map((clip, position) => ({ clip, position,
    score: (clip.id === input.selectedClipId ? 1_000_000 : 0) + (supportIds.has(clip.id) ? 100_000 : 0)
      + (context.evidence.some(entry => entry.fact.range.assetId === clip.assetId && entry.fact.range.inMs < clip.outPoint && clip.inPoint < entry.fact.range.outMs) ? 10_000 : 0)
      + matches(`${clip.id} ${assetById(timeline, clip.assetId)?.name ?? ""}`, query) * 1000,
    distance: Math.abs(clip.start - nearby),
  })).sort((a, b) => b.score - a.score || a.distance - b.distance || a.position - b.position);
  for (const { clip } of rankedClips) {
    if (context.clips.length >= 60) break;
    if (!addClip(clip)) break;
  }
  context.coverage.includedEvidence = context.evidence.length;
  context.coverage.omittedEvidence = document.evidence.length - context.evidence.length;
  context.coverage.omittedClips = clips.length - context.clips.length;
  if (JSON.stringify(context).length > budget) throw new Error("Production context exceeds its configured budget.");
  return context;
}
