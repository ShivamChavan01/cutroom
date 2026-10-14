/**
 * Swap decisions for the double-buffered player, as pure functions.
 *
 * The component (`Player.tsx`) touches elements, timers and the store; this
 * module owns the *policy*: given the active asset and a snapshot of element
 * state, what should happen. Policy is testable without a media element,
 * which matters because jsdom implements no media behavior at all — these
 * tests are the only executable spec of the swap matrix.
 *
 * One structural rule pins the absolute-vs-relative URL bug class: element
 * identity is compared by content asset id, never by URL string. `live.src`
 * resolves to an absolute URL while the registry hands out root-relative
 * ones, so any comparison through URLs is wrong on arrival. URLs do not
 * appear in these signatures at all.
 */

export type Side = "a" | "b";

export function otherSide(side: Side): Side {
  return side === "a" ? "b" : "a";
}

/** Identity is by content id. URLs never enter a swap decision. */
export function sameAsset(a: string | null, b: string): boolean {
  return a === b;
}

export interface WarmSlot {
  readonly side: Side;
  readonly assetId: string;
}

export interface SwapSnapshot {
  readonly liveSide: Side;
  /** Content asset id loaded per element. Null = nothing loaded yet. */
  readonly loadedAsset: Readonly<Record<Side, string | null>>;
  /** Warm slot plus whether its element reports readyState >= 4. */
  readonly warm: (WarmSlot & { readonly elementReady: boolean }) | null;
}

export type SwapDecision =
  /** Live element already has the asset: drift-correct only. */
  | { readonly kind: "stay" }
  /** Warm element is ready for the asset: flip roles and play it. */
  | { readonly kind: "flip"; readonly to: Side }
  /** Nothing warm: load the URL into the live element. */
  | { readonly kind: "coldLoad"; readonly side: Side }
  /** No active clip (gap / missing media): stop, don't freeze. */
  | { readonly kind: "nothing" };

/**
 * Does the slot describe warming `assetId` on `side`? Shared by the policy
 * and the component so the match rule lives in exactly one place.
 */
export function warmMatches(
  slot: WarmSlot | null,
  side: Side,
  assetId: string,
): boolean {
  return slot !== null && slot.side === side && sameAsset(slot.assetId, assetId);
}

/**
 * A warm slot is stale when it targets the live side (roles flipped under
 * it) or a different asset (user sought, or the timeline changed under
 * playback). Stale slots must never be flipped to.
 */
export function isWarmStale(
  slot: WarmSlot | null,
  liveSide: Side,
  wantedAssetId: string,
): boolean {
  if (slot === null) return false;
  return slot.side === liveSide || !sameAsset(slot.assetId, wantedAssetId);
}

export function decideSwap(
  activeAssetId: string | null,
  snap: SwapSnapshot,
): SwapDecision {
  if (activeAssetId === null) return { kind: "nothing" };
  if (sameAsset(snap.loadedAsset[snap.liveSide], activeAssetId)) {
    return { kind: "stay" };
  }
  const warm = snap.warm;
  if (
    warm !== null &&
    warm.side !== snap.liveSide &&
    sameAsset(warm.assetId, activeAssetId) &&
    warm.elementReady
  ) {
    return { kind: "flip", to: warm.side };
  }
  return { kind: "coldLoad", side: snap.liveSide };
}

export interface WarmOptions {
  readonly preloadEnabled: boolean;
  readonly preloadAheadMs: number;
}

export type WarmAction = "warm" | "idle";

export function decideWarm(
  nextAssetId: string | null,
  untilEndMs: number,
  snap: Pick<SwapSnapshot, "liveSide"> & { readonly warm: WarmSlot | null },
  opts: WarmOptions,
): WarmAction {
  if (!opts.preloadEnabled) return "idle";
  if (nextAssetId === null) return "idle";
  if (untilEndMs >= opts.preloadAheadMs) return "idle";
  if (warmMatches(snap.warm, otherSide(snap.liveSide), nextAssetId)) {
    return "idle";
  }
  return "warm";
}
