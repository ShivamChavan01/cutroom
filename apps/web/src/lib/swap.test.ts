import { describe, expect, it } from "vitest";
import {
  decideSwap,
  decideWarm,
  isWarmStale,
  otherSide,
  sameAsset,
  warmMatches,
  type SwapSnapshot,
} from "./swap";

const OPTS = { preloadEnabled: true, preloadAheadMs: 1_000 } as const;

function snap(overrides: Partial<SwapSnapshot> = {}): SwapSnapshot {
  return {
    liveSide: "a",
    loadedAsset: { a: "asset-a", b: null },
    warm: null,
    ...overrides,
  };
}

describe("decideSwap", () => {
  it("stays when the live element already has the asset", () => {
    // Edit-during-playback case: the clip id changed (split/trim/move) but
    // the asset did not. Decisions key on asset id, so clip-identity churn
    // is invisible here by construction.
    expect(decideSwap("asset-a", snap())).toEqual({ kind: "stay" });
  });

  it("flips to the warm element at a normal boundary", () => {
    const decision = decideSwap("asset-b", snap({
      warm: { side: "b" as const, assetId: "asset-b", elementReady: true },
    }));
    expect(decision).toEqual({ kind: "flip", to: "b" });
  });

  it("cold-loads when the warm element is not ready yet", () => {
    const decision = decideSwap("asset-b", snap({
      warm: { side: "b" as const, assetId: "asset-b", elementReady: false },
    }));
    expect(decision).toEqual({ kind: "coldLoad", side: "a" });
  });

  it("cold-loads when warming targeted a different asset (seek during warming)", () => {
    // User sought from b's region to c while b was still warming.
    const slot = { side: "b" as const, assetId: "asset-b" };
    expect(isWarmStale(slot, "a", "asset-c")).toBe(true);
    const decision = decideSwap("asset-c", snap({
      warm: { ...slot, elementReady: true as const },
    }));
    expect(decision).toEqual({ kind: "coldLoad", side: "a" });
  });

  it("never flips to a warm slot sitting on the live side", () => {
    const slot = { side: "a" as const, assetId: "asset-b" };
    expect(isWarmStale(slot, "a", "asset-b")).toBe(true);
    const decision = decideSwap("asset-b", snap({
      loadedAsset: { a: "asset-a", b: null },
      warm: { ...slot, elementReady: true as const },
    }));
    expect(decision).toEqual({ kind: "coldLoad", side: "a" });
  });

  it("stops on gaps instead of freezing", () => {
    expect(decideSwap(null, snap())).toEqual({ kind: "nothing" });
  });
});

describe("decideWarm", () => {
  const liveA = { liveSide: "a" as const, warm: null };

  it("idles with preloading disabled, however close the boundary", () => {
    expect(
      decideWarm("asset-b", 10, liveA, { ...OPTS, preloadEnabled: false }),
    ).toBe("idle");
  });

  it("idles when the current clip is the last one", () => {
    expect(decideWarm(null, 10, liveA, OPTS)).toBe("idle");
  });

  it("idles while the boundary is still far away", () => {
    expect(decideWarm("asset-b", 5_000, liveA, OPTS)).toBe("idle");
  });

  it("starts warming inside the preload window", () => {
    expect(decideWarm("asset-b", 500, liveA, OPTS)).toBe("warm");
  });

  it("keeps an already-correct warm slot instead of re-warming", () => {
    expect(
      decideWarm("asset-b", 500, {
        liveSide: "a",
        warm: { side: "b" as const, assetId: "asset-b" },
      }, OPTS),
    ).toBe("idle");
  });

  it("re-warms when the slot targets a superseded clip", () => {
    // Edit during playback moved the boundary: slot warms asset-b, but the
    // next clip is now asset-c.
    expect(
      decideWarm("asset-c", 500, {
        liveSide: "a",
        warm: { side: "b" as const, assetId: "asset-b" },
      }, OPTS),
    ).toBe("warm");
  });
});

describe("identity rule (absolute-vs-relative URL regression)", () => {
  it("compares content ids, so URL form can never matter", () => {
    // The old code compared `live.src !== url`: element src resolves to an
    // absolute URL while the registry hands out root-relative ones, so the
    // comparison was wrong on arrival and every boundary cold-loaded.
    // decideSwap takes no URLs — this pins that structural guarantee by
    // showing identity holds for equal ids with no URL in scope.
    expect(sameAsset("asset-a", "asset-a")).toBe(true);
    expect(sameAsset(null, "asset-a")).toBe(false);
    expect(sameAsset("asset-a", "asset-b")).toBe(false);
    expect(decideSwap("asset-a", snap())).toEqual({ kind: "stay" });
  });

  it("warmMatches and otherSide behave", () => {
    expect(otherSide("a")).toBe("b");
    expect(otherSide("b")).toBe("a");
    expect(warmMatches({ side: "b", assetId: "x" }, "b", "x")).toBe(true);
    expect(warmMatches({ side: "b", assetId: "x" }, "a", "x")).toBe(false);
    expect(warmMatches(null, "b", "x")).toBe(false);
  });
});
