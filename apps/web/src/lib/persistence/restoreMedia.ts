import type { Timeline } from "@cutroom/engine";
import { registerAssetUrls } from "../assets";
import { isOpfsAvailable, readMediaUrl } from "../media/opfs";

interface MediaRestoreResult {
  readonly restored: number;
  readonly missing: number;
  readonly warning: string | null;
}

const CONCURRENT_READS = 4;

/** Restore URLs together so a large media library causes one registry update. */
export async function restoreMedia(timeline: Timeline, signal?: AbortSignal): Promise<MediaRestoreResult> {
  const assetIds = Object.keys(timeline.assets);
  if (assetIds.length === 0 || signal?.aborted) {
    return { restored: 0, missing: 0, warning: null };
  }
  if (!isOpfsAvailable()) {
    return {
      restored: 0,
      missing: assetIds.length,
      warning: "this browser has no private file system — stored media cannot be restored",
    };
  }

  const entries: [string, string][] = [];
  let nextAsset = 0;
  let missing = 0;
  const releaseUrls = (): void => {
    for (const [, url] of entries) URL.revokeObjectURL(url);
    entries.length = 0;
  };
  signal?.addEventListener("abort", releaseUrls, { once: true });
  const readNext = async (): Promise<void> => {
    while (!signal?.aborted) {
      const assetId = assetIds[nextAsset++];
      if (assetId === undefined) return;
      try {
        const url = await readMediaUrl(assetId);
        if (signal?.aborted) {
          if (url !== null) URL.revokeObjectURL(url);
          return;
        }
        if (url === null) missing += 1;
        else entries.push([assetId, url]);
      } catch {
        missing += 1;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENT_READS, assetIds.length) }, readNext));
  } finally {
    signal?.removeEventListener("abort", releaseUrls);
  }
  if (signal?.aborted) {
    return { restored: 0, missing: 0, warning: null };
  }
  registerAssetUrls(entries);
  return {
    restored: entries.length,
    missing,
    warning: missing > 0 ? `${missing} of ${assetIds.length} stored media file(s) are not on disk` : null,
  };
}
