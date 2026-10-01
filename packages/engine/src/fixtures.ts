import { describe, expect, it } from "vitest";
import {
  type Timeline,
  applyOps,
  emptyTimeline,
  makeClip,
  putAsset,
} from "./index";

export const ASSET_DURATION = 30_000;

/** Base timeline: one video clip on v1 from 0s to 10s. */
export function baseTimeline(): Timeline {
  let t = emptyTimeline("test");
  t = putAsset(t, {
    id: "asset-a",
    kind: "video",
    duration: ASSET_DURATION,
    width: 1920,
    height: 1080,
  });
  return applyOps(t, [
    {
      type: "addClip",
      clip: makeClip({
        id: "c1",
        trackId: "v1",
        assetId: "asset-a",
        start: 0,
        inPoint: 0,
        duration: 10_000,
        volume: 1,
      }),
    },
  ]);
}

export function clipOn(
  timeline: Timeline,
  id: string,
  patch: { trackId?: string; assetId?: string; start?: number } = {},
): Timeline {
  return applyOps(timeline, [
    {
      type: "addClip",
      clip: makeClip({
        id,
        trackId: patch.trackId ?? "v1",
        assetId: patch.assetId ?? "asset-a",
        start: patch.start ?? 0,
        inPoint: 0,
        duration: 1_000,
        volume: 1,
      }),
    },
  ]);
}
