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
  if (resolveAssetUrl(assetId) === url) return;
  useAssetUrls.setState((urls) => new Map(urls).set(assetId, url), true);
}

export function resolveAssetUrl(assetId: string): string | undefined {
  return useAssetUrls.getState().get(assetId);
}

export function clearAssetUrls(): void {
  if (useAssetUrls.getState().size === 0) return;
  useAssetUrls.setState(new Map(), true);
}
