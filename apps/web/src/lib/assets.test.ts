import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAssetUrls,
  registerAssetUrl,
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
});
