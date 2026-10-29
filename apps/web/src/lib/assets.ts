import { create } from "zustand";

/**
 * Asset ID -> playable URL.
 *
 * The engine references assets by content hash, never by location. The
 * player needs the opposite: a URL for a hash. This registry is the seam
 * between the two. The real asset layer (upload, OPFS cache, proxy/full
 * selection) will own this map; until then, seeding and tests register
 * local URLs explicitly.
 */
export const useAssetUrls = create<ReadonlyMap<string, string>>(() => new Map());

export function registerAssetUrl(assetId: string, url: string): void {
  registerAssetUrls([[assetId, url]]);
}

export function registerAssetUrls(entries: Iterable<readonly [string, string]>): void {
  useAssetUrls.setState((urls) => {
    let next: Map<string, string> | null = null;
    for (const [assetId, url] of entries) {
      if ((next ?? urls).get(assetId) === url) continue;
      next ??= new Map(urls);
      next.set(assetId, url);
    }
    if (next === null) return urls;
    if (next.size === urls.size && [...next].every(([id, url]) => urls.get(id) === url)) return urls;
    return next;
  }, true);
}

export function resolveAssetUrl(assetId: string): string | undefined {
  return useAssetUrls.getState().get(assetId);
}

export function clearAssetUrls(): void {
  if (useAssetUrls.getState().size === 0) return;
  useAssetUrls.setState(new Map(), true);
}
