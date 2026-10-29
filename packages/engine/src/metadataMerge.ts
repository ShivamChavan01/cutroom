import type { Asset, Timeline, Track } from "./model";
import { refreshMergeConflicts, type Conflict, type MergeResult } from "./merge";

const ASSET_FIELDS = ["kind", "duration", "width", "height", "bytes", "proxyId", "name", "mimeType"] as const;
const TRACK_FIELDS = ["kind", "name", "muted"] as const;
type Value = string | number | boolean | undefined;
export type MetadataConflict =
  | { readonly kind: "assetField"; readonly assetId: string; readonly field: typeof ASSET_FIELDS[number]; readonly base: Value; readonly ours: Value; readonly theirs: Value }
  | { readonly kind: "trackField"; readonly trackId: string; readonly field: typeof TRACK_FIELDS[number]; readonly base: Value; readonly ours: Value; readonly theirs: Value }
  | { readonly kind: "assetPresence"; readonly assetId: string; readonly base: Asset; readonly ours: Asset | undefined; readonly theirs: Asset | undefined }
  | { readonly kind: "trackPresence"; readonly trackId: string; readonly base: Track; readonly ours: Track | undefined; readonly theirs: Track | undefined }
  | { readonly kind: "trackOrder"; readonly base: readonly string[]; readonly ours: readonly string[]; readonly theirs: readonly string[] };

function equalTags(a: Asset, b: Asset): boolean {
  const left = new Set(a.tags ?? []);
  const right = new Set(b.tags ?? []);
  return left.size === right.size && [...left].every(tag => right.has(tag));
}
function mergeAsset(id: string, base: Asset | undefined, ours: Asset, theirs: Asset, conflicts: MetadataConflict[]): Asset {
  const result = { ...ours };
  for (const field of ASSET_FIELDS) {
    if (ours[field] === theirs[field] || (base !== undefined && theirs[field] === base[field])) continue;
    if (base !== undefined && ours[field] === base[field]) Object.assign(result, { [field]: theirs[field] });
    else conflicts.push({ kind: "assetField", assetId: id, field, base: base?.[field], ours: ours[field], theirs: theirs[field] });
  }
  if (base?.tags !== undefined || ours.tags !== undefined || theirs.tags !== undefined) {
    const b = new Set(base?.tags ?? []), o = new Set(ours.tags ?? []), t = new Set(theirs.tags ?? []);
    result.tags = [...new Set([...o, ...t, ...b])].filter(tag => o.has(tag) === b.has(tag) ? t.has(tag) : o.has(tag));
  }
  return result;
}
function mergeTrack(id: string, base: Track | undefined, ours: Track, theirs: Track, conflicts: MetadataConflict[]): Track {
  const result = { ...ours };
  for (const field of TRACK_FIELDS) {
    if (ours[field] === theirs[field] || (base !== undefined && theirs[field] === base[field])) continue;
    if (base !== undefined && ours[field] === base[field]) Object.assign(result, { [field]: theirs[field] });
    else conflicts.push({ kind: "trackField", trackId: id, field, base: base?.[field], ours: ours[field], theirs: theirs[field] });
  }
  return result;
}
const sameOrder = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i]);

function referencedByClip(clips: Timeline["clips"], conflicts: readonly Conflict[], field: "assetId" | "trackId", id: string): boolean {
  // The provisional clip keeps ours, but a pending choice must remain usable.
  return Object.values(clips).some(clip => clip[field] === id) || conflicts.some(conflict =>
    conflict.kind === "field" && conflict.field === field && clips[conflict.clipId] !== undefined &&
    (conflict.ours === id || conflict.theirs === id));
}

/** Metadata uses the same three-way rules as clips; tags are unordered membership. */
export function mergeMetadata(base: Timeline, ours: Timeline, theirs: Timeline, clips: Timeline["clips"], clipConflicts: readonly Conflict[] = []): { assets: Timeline["assets"]; tracks: Timeline["tracks"]; conflicts: MetadataConflict[] } {
  const conflicts: MetadataConflict[] = [];
  const assets: Record<string, Asset> = {};
  for (const id of new Set([...Object.keys(base.assets), ...Object.keys(ours.assets), ...Object.keys(theirs.assets)])) {
    const b = base.assets[id], o = ours.assets[id], t = theirs.assets[id];
    if (o !== undefined && t !== undefined) assets[id] = mergeAsset(id, b, o, t, conflicts);
    else if (b === undefined) {
      const survivor = o ?? t;
      if (survivor !== undefined) assets[id] = survivor;
    } else {
      const survivor = o ?? t;
      const referenced = referencedByClip(clips, clipConflicts, "assetId", id);
      const modified = survivor !== undefined && (!ASSET_FIELDS.every(field => b[field] === survivor[field]) || !equalTags(b, survivor));
      if (modified || referenced) {
        assets[id] = survivor ?? b;
        conflicts.push({ kind: "assetPresence", assetId: id, base: b, ours: o, theirs: t });
      }
    }
  }
  const byId = (timeline: Timeline): Map<string, Track> => new Map(timeline.tracks.map(track => [track.id, track]));
  const bs = byId(base), os = byId(ours), ts = byId(theirs);
  const tracks = new Map<string, Track>();
  for (const id of new Set([...bs.keys(), ...os.keys(), ...ts.keys()])) {
    const b = bs.get(id), o = os.get(id), t = ts.get(id);
    if (o !== undefined && t !== undefined) tracks.set(id, mergeTrack(id, b, o, t, conflicts));
    else if (b === undefined) {
      const survivor = o ?? t;
      if (survivor !== undefined) tracks.set(id, survivor);
    } else {
      const survivor = o ?? t;
      const referenced = referencedByClip(clips, clipConflicts, "trackId", id);
      if (referenced || (survivor !== undefined && !TRACK_FIELDS.every(field => b[field] === survivor[field]))) {
        tracks.set(id, survivor ?? b);
        conflicts.push({ kind: "trackPresence", trackId: id, base: b, ours: o, theirs: t });
      }
    }
  }
  // Deleted metadata may be provisionally retained for surviving clips. Fill
  // those holes in base order while the explicit presence choice is pending.
  const order = (timeline: Timeline): string[] => {
    const ids = timeline.tracks.map(t => t.id).filter(id => tracks.has(id));
    const baseIds = base.tracks.map(t => t.id).filter(id => tracks.has(id));
    for (let i = baseIds.length - 1; i >= 0; i--) {
      const id = baseIds[i]!;
      if (ids.includes(id)) continue;
      const anchor = baseIds.slice(i + 1).find(next => ids.includes(next));
      ids.splice(anchor === undefined ? ids.length : ids.indexOf(anchor), 0, id);
    }
    return ids;
  };
  const bo = order(base), oo = order(ours), to = order(theirs);
  let preferred = oo;
  if (sameOrder(oo, bo)) preferred = to;
  else if (!sameOrder(to, bo) && !sameOrder(oo, to)) {
    const appendsBase = (ids: readonly string[]): boolean => bo.every((id, i) => ids[i] === id);
    // Independent appended tracks have an explicit deterministic policy:
    // ours first, then theirs. Other concurrent layer-order edits need a choice.
    const sharedOurs = oo.filter(id => to.includes(id));
    const sharedTheirs = to.filter(id => oo.includes(id));
    if (!appendsBase(oo) || !appendsBase(to) || !sameOrder(sharedOurs, sharedTheirs)) conflicts.push({ kind: "trackOrder", base: bo, ours: oo, theirs: to });
  }
  const ids = [...new Set([...preferred, ...oo, ...to, ...tracks.keys()])];
  return { assets, tracks: ids.flatMap(id => { const track = tracks.get(id); return track === undefined ? [] : [track]; }), conflicts };
}

/** Resolves exactly the current semantic conflict. No clip timing is changed. */
export function resolveMetadata(result: MergeResult, conflict: MetadataConflict, choice: "ours" | "theirs" | "keep"): MergeResult {
  if (!result.conflicts.includes(conflict)) return result;
  let merged = result.merged;
  switch (conflict.kind) {
    case "assetField": {
      const asset = merged.assets[conflict.assetId];
      if (asset === undefined || choice === "keep") throw new Error("Choose an asset field value from ours or theirs.");
      merged = { ...merged, assets: { ...merged.assets, [asset.id]: { ...asset, [conflict.field]: conflict[choice] } } };
      break;
    }
    case "trackField": {
      if (choice === "keep") throw new Error("Choose a track field value from ours or theirs.");
      merged = { ...merged, tracks: merged.tracks.map(track => track.id === conflict.trackId ? { ...track, [conflict.field]: conflict[choice] } : track) };
      break;
    }
    case "assetPresence": {
      const asset = choice === "keep" ? merged.assets[conflict.assetId] ?? conflict.base : conflict[choice];
      if (asset === undefined && referencedByClip(merged.clips, result.conflicts, "assetId", conflict.assetId)) throw new Error("Remove referencing clips or resolve their references before deleting this asset, or keep the metadata.");
      const assets = { ...merged.assets };
      if (asset === undefined) delete assets[conflict.assetId]; else assets[conflict.assetId] = asset;
      merged = { ...merged, assets };
      break;
    }
    case "trackPresence": {
      const track = choice === "keep" ? merged.tracks.find(track => track.id === conflict.trackId) ?? conflict.base : conflict[choice];
      if (track === undefined && referencedByClip(merged.clips, result.conflicts, "trackId", conflict.trackId)) throw new Error("Remove referencing clips or resolve their references before deleting this track, or keep the metadata.");
      merged = { ...merged, tracks: track === undefined ? merged.tracks.filter(t => t.id !== conflict.trackId) : merged.tracks.map(t => t.id === conflict.trackId ? track : t) };
      break;
    }
    case "trackOrder": {
      if (choice === "keep") throw new Error("Choose track order from ours or theirs.");
      const ids = [...new Set([...conflict[choice], ...merged.tracks.map(t => t.id)])];
      merged = { ...merged, tracks: ids.flatMap(id => { const track = merged.tracks.find(t => t.id === id); return track === undefined ? [] : [track]; }) };
      break;
    }
    default: { const exhaustive: never = conflict; return exhaustive; }
  }
  return refreshMergeConflicts({ ...result, merged, conflicts: result.conflicts.filter(item => item !== conflict) });
}

/** Stable semantic keys survive list reordering and geometry refresh. */
export function metadataConflictKey(conflict: MetadataConflict): string {
  switch (conflict.kind) {
    case "assetField": return JSON.stringify([conflict.kind, conflict.assetId, conflict.field]);
    case "trackField": return JSON.stringify([conflict.kind, conflict.trackId, conflict.field]);
    case "assetPresence": return JSON.stringify([conflict.kind, conflict.assetId]);
    case "trackPresence": return JSON.stringify([conflict.kind, conflict.trackId]);
    case "trackOrder": return conflict.kind;
    default: { const exhaustive: never = conflict; return exhaustive; }
  }
}
