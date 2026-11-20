import { assetById, timelineDuration, type Clip, type Timeline } from "@cutroom/engine";
import type { ProductionDocument, ProductionRequirement, SourceRange } from "./document";

export interface ProductionCheck {
  readonly id: string;
  readonly label: string;
  readonly priority: ProductionRequirement["priority"];
  readonly status: "pass" | "fail" | "needs-review";
  readonly message: string;
  readonly clipIds: readonly string[];
  readonly breaches: readonly { readonly key: string; readonly amount: number }[];
}

export interface RangePlacement {
  readonly start: number;
  readonly end: number;
  readonly clipIds: readonly string[];
}

function sourceIndex(timeline: Timeline) {
  const index = new Map<string, Clip[]>();
  for (const clip of Object.values(timeline.clips)) {
    const entries = index.get(clip.assetId) ?? [];
    entries.push(clip); index.set(clip.assetId, entries);
  }
  return index;
}

function locate(timeline: Timeline, range: SourceRange, index: ReturnType<typeof sourceIndex>) {
  const asset = assetById(timeline, range.assetId);
  if (asset === undefined || range.outMs > asset.duration || (range.channel === "video" && asset.kind === "audio")
    || (range.channel === "audio" && asset.kind === "image")) return { known: false, coveredMs: 0, placements: [], clipIds: [] };
  const tracks = new Map(timeline.tracks.map(track => [track.id, track]));
  const groups = new Map<number, Clip[]>();
  for (const clip of index.get(range.assetId) ?? []) {
    const track = tracks.get(clip.trackId);
    if (track === undefined || (range.channel === "video" && track.kind !== "video")
      || (range.channel === "audio" && (clip.volume === 0 || track.muted))) continue;
    if (clip.inPoint >= range.outMs || clip.outPoint <= range.inMs) continue;
    const offset = clip.start - clip.inPoint;
    const entries = groups.get(offset) ?? []; entries.push(clip); groups.set(offset, entries);
  }
  const placements: RangePlacement[] = [], clipIds = new Set<string>();
  let coveredMs = 0;
  for (const [offset, clips] of groups) {
    const intervals = clips.map(clip => ({ start: Math.max(range.inMs, clip.inPoint), end: Math.min(range.outMs, clip.outPoint) }))
      .sort((a, b) => a.start - b.start);
    let cursor = range.inMs, covered = 0;
    for (const interval of intervals) {
      covered += Math.max(0, interval.end - Math.max(cursor, interval.start));
      cursor = Math.max(cursor, interval.end);
    }
    coveredMs = Math.max(coveredMs, covered);
    for (const clip of clips) clipIds.add(clip.id);
    if (covered === range.outMs - range.inMs) placements.push({ start: range.inMs + offset, end: range.outMs + offset, clipIds: clips.map(clip => clip.id) });
  }
  return { known: true, coveredMs, placements, clipIds: [...clipIds] };
}

export function sourcePlacements(timeline: Timeline, range: SourceRange): readonly RangePlacement[] {
  return locate(timeline, range, sourceIndex(timeline)).placements;
}

export function reviewProduction(timeline: Timeline, document: ProductionDocument): readonly ProductionCheck[] {
  const index = sourceIndex(timeline), duration = timelineDuration(timeline);
  return document.requirements.map(requirement => {
    const base = { id: requirement.id, label: requirement.label, priority: requirement.priority };
    switch (requirement.kind) {
      case "duration": {
        const distance = Math.max(0, requirement.minMs - duration, duration - requirement.maxMs);
        return { ...base, status: distance === 0 ? "pass" : "fail", message: `Timeline duration ${duration}ms; required range ${requirement.minMs}–${requirement.maxMs}ms.`,
          clipIds: [], breaches: distance === 0 ? [] : [{ key: "duration", amount: distance }] };
      }
      case "editorial":
        return { ...base, status: "needs-review", message: `Human review required: ${requirement.instruction}`, clipIds: [], breaches: [] };
      case "preserve": {
        const result = locate(timeline, requirement.range, index);
        const missing = requirement.range.outMs - requirement.range.inMs - result.coveredMs;
        return { ...base, status: !result.known ? "needs-review" : result.placements.length > 0 ? "pass" : "fail",
          message: !result.known ? "Source metadata is missing, incompatible or shorter than the required range."
            : result.placements.length > 0 ? "Complete source range has a continuous timeline placement. Audio placement requires nonzero gain and an unmuted timeline track."
            : `${missing}ms of the source range is missing from a continuous placement.`,
          clipIds: result.clipIds, breaches: missing === 0 ? [] : [{ key: "coverage", amount: missing }] };
      }
      case "sequence": {
        const locations = requirement.ranges.map(range => locate(timeline, range, index));
        const breaches: { key: string; amount: number }[] = [];
        let unknown = false;
        locations.forEach((location, position) => {
          const range = requirement.ranges[position];
          if (!location.known || location.placements.length > 1) unknown = true;
          if (location.known && location.placements.length === 0 && range !== undefined) {
            breaches.push({ key: `coverage:${position}`, amount: range.outMs - range.inMs - location.coveredMs });
          }
          const before = locations[position - 1]?.placements, after = location.placements;
          if (before?.length === 1 && after.length === 1 && before[0] !== undefined && after[0] !== undefined) {
            const gap = after[0].start - before[0].end;
            if (gap < 0) breaches.push({ key: `order:${position}`, amount: -gap });
            if (gap > requirement.maxGapMs) breaches.push({ key: `gap:${position}`, amount: gap - requirement.maxGapMs });
          }
        });
        return { ...base, status: breaches.length > 0 ? "fail" : unknown ? "needs-review" : "pass",
          message: breaches.length > 0 ? "Required story order, source coverage or maximum gap is violated."
            : unknown ? "Missing source metadata or repeated source occurrences make this sequence ambiguous."
            : "Required source ranges occur once, in order, within the specified gap. Visual continuity still needs review.",
          clipIds: [...new Set(locations.flatMap(location => location.clipIds))], breaches };
      }
    }
  });
}

export function assertProductionPreserved(before: Timeline, after: Timeline, document: ProductionDocument): void {
  const previous = new Map(reviewProduction(before, document).map(check => [check.id, check]));
  const regressions = reviewProduction(after, document).filter(check => {
    if (check.priority !== "required") return false;
    const old = previous.get(check.id);
    if (old?.status === "pass" && check.status !== "pass") return true;
    return check.breaches.some(breach => breach.amount > (old?.breaches.find(entry => entry.key === breach.key)?.amount ?? 0));
  });
  if (regressions.length > 0) throw new Error(`Proposal worsens required production constraints: ${regressions.map(check => check.label).join(", ")}.`);
}
