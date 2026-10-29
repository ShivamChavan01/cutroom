import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAssetUrls,
  registerAssetUrl,
  registerAssetUrls,
  resolveAssetUrl,
  useAssetUrls,
} from "./assets";

describe("asset URLs", () => {
  beforeEach(() => clearAssetUrls());

  it("returns undefined for unavailable media", () => {
    expect(resolveAssetUrl("missing")).toBeUndefined();
  });

  it("registers media without replacing unrelated assets", () => {
    registerAssetUrl("a", "blob:a");
    registerAssetUrl("b", "blob:b");
    expect(resolveAssetUrl("a")).toBe("blob:a");
    expect(resolveAssetUrl("b")).toBe("blob:b");
  });

  it("notifies consumers when missing media becomes available", () => {
    const observed: (string | undefined)[] = [];
    const unsubscribe = useAssetUrls.subscribe((urls) => {
      observed.push(urls.get("a"));
    });
    try {
      registerAssetUrl("a", "blob:a");
      expect(observed).toEqual(["blob:a"]);
    } finally {
      unsubscribe();
    }
  });

  it("publishes a replacement without mutating the prior snapshot", () => {
    registerAssetUrl("a", "blob:old");
    const previous = useAssetUrls.getState();
    registerAssetUrl("a", "blob:new");
    expect(previous.get("a")).toBe("blob:old");
    expect(resolveAssetUrl("a")).toBe("blob:new");
  });

  it("does not notify consumers for an unchanged URL", () => {
    registerAssetUrl("a", "blob:a");
    const listener = vi.fn();
    const unsubscribe = useAssetUrls.subscribe(listener);
    try {
      registerAssetUrl("a", "blob:a");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("clears media and notifies consumers that it is unavailable", () => {
    registerAssetUrl("a", "blob:a");
    const observed: (string | undefined)[] = [];
    const unsubscribe = useAssetUrls.subscribe((urls) => {
      observed.push(urls.get("a"));
    });
    try {
      clearAssetUrls();
      expect(resolveAssetUrl("a")).toBeUndefined();
      expect(observed).toEqual([undefined]);
    } finally {
      unsubscribe();
    }
  });

  it("publishes a batch once while preserving unrelated assets and prior snapshots", () => {
    registerAssetUrl("unrelated", "blob:live");
    const previous = useAssetUrls.getState();
    const snapshots: ReadonlyMap<string, string>[] = [];
    const unsubscribe = useAssetUrls.subscribe((urls) => snapshots.push(urls));
    try {
      registerAssetUrls([["a", "blob:a"], ["b", "blob:b"]]);
      expect(snapshots).toHaveLength(1);
      expect([...useAssetUrls.getState()]).toEqual([
        ["unrelated", "blob:live"], ["a", "blob:a"], ["b", "blob:b"],
      ]);
      expect([...previous]).toEqual([["unrelated", "blob:live"]]);
    } finally {
      unsubscribe();
    }
  });

  it("does not notify for empty, unchanged or reverted batches", () => {
    registerAssetUrl("a", "blob:a");
    const previous = useAssetUrls.getState();
    const listener = vi.fn();
    const unsubscribe = useAssetUrls.subscribe(listener);
    try {
      registerAssetUrls([]);
      registerAssetUrls([["a", "blob:a"]]);
      registerAssetUrls([["a", "blob:temporary"], ["a", "blob:a"]]);
      expect(listener).not.toHaveBeenCalled();
      expect(useAssetUrls.getState()).toBe(previous);
    } finally {
      unsubscribe();
    }
  });

  it("uses the last URL for duplicate asset IDs in a batch", () => {
    registerAssetUrls([["a", "blob:first"], ["a", "blob:last"]]);
    expect(resolveAssetUrl("a")).toBe("blob:last");
  });

  it("keeps the registry unchanged if reading a batch fails", () => {
    registerAssetUrl("a", "blob:live");
    const previous = useAssetUrls.getState();
    function* brokenEntries(): Generator<readonly [string, string]> {
      yield ["b", "blob:b"];
      throw new Error("batch failed");
    }
    expect(() => registerAssetUrls(brokenEntries())).toThrow("batch failed");
    expect(useAssetUrls.getState()).toBe(previous);
    expect(resolveAssetUrl("b")).toBeUndefined();
  });
});
