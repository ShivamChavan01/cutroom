/**
 * Asset ID -> playable URL.
 *
 * The engine references assets by content hash, never by location. The
 * player needs the opposite: a URL for a hash. This registry is the seam
 * between the two. The real asset layer (upload, OPFS cache, proxy/full
 * selection) will own this map; until then, seeding and tests register
 * local URLs explicitly.
 */
const urls = new Map<string, string>();

export function registerAssetUrl(assetId: string, url: string): void {
  urls.set(assetId, url);
}

export function resolveAssetUrl(assetId: string): string | undefined {
  return urls.get(assetId);
}

export function clearAssetUrls(): void {
  urls.clear();
}
