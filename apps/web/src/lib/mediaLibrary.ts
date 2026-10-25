import { type Asset, type Timeline, makeClip, timelineDuration } from "@cutroom/engine";

export type MediaSection = "footage" | "graphics";

export function mediaLabel(asset: Asset, index: number): string {
  return asset.name?.trim() || `${asset.kind === "image" ? "Graphic" : asset.kind === "audio" ? "Audio" : "Video"} ${String(index + 1).padStart(2, "0")}`;
}

export function filterMediaAssets(
  assets: readonly Asset[],
  { section, query, tag }: { section: MediaSection; query: string; tag: string },
): readonly Asset[] {
  const search = query.trim().toLocaleLowerCase();
  return assets.filter((asset) => {
    if ((asset.kind === "image") !== (section === "graphics")) return false;
    if (tag !== "" && !asset.tags?.includes(tag)) return false;
    return search === "" || [asset.name ?? "", asset.id, ...(asset.tags ?? [])]
      .some((value) => value.toLocaleLowerCase().includes(search));
  });
}

export function mediaTags(assets: readonly Asset[]): readonly string[] {
  return [...new Set(assets.flatMap((asset) => asset.tags ?? []))]
    .sort((a, b) => a.localeCompare(b));
}

export function parseMediaTags(input: string): readonly string[] {
  const tags = new Map<string, string>();
  for (const raw of input.split(",")) {
    const tag = raw.trim();
    if (tag === "") continue;
    if (tag.length > 40) throw new Error("Keep each tag to 40 characters or fewer.");
    tags.set(tag.toLocaleLowerCase(), tag);
  }
  if (tags.size > 12) throw new Error("Use at most 12 tags for a media file.");
  return [...tags.values()];
}

export function clipForMedia(timeline: Timeline, assetId: string) {
  const asset = timeline.assets[assetId];
  if (asset === undefined) throw new Error("This media is no longer in the project.");
  const track = timeline.tracks.find((item) => item.kind === (asset.kind === "audio" ? "audio" : "video"));
  if (track === undefined) throw new Error("Add a matching track before placing this media.");
  let id = `clip-${asset.id.slice(0, 8)}`;
  for (let suffix = 2; timeline.clips[id] !== undefined; suffix++) {
    id = `clip-${asset.id.slice(0, 8)}-${suffix}`;
  }
  return makeClip({ id, trackId: track.id, assetId, start: timelineDuration(timeline), inPoint: 0, duration: asset.duration, volume: 1 });
}
