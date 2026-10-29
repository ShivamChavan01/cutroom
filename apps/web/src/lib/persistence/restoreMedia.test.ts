import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyTimeline, type Timeline } from "@cutroom/engine";
import { clearAssetUrls, registerAssetUrl, resolveAssetUrl, useAssetUrls } from "../assets";
import { isOpfsAvailable, readMediaUrl } from "../media/opfs";
import { restoreMedia } from "./restoreMedia";

vi.mock("../media/opfs", () => ({
  isOpfsAvailable: vi.fn(),
  readMediaUrl: vi.fn(),
}));

function withAssets(count: number): Timeline {
  return {
    ...emptyTimeline("recovery"),
    assets: Object.fromEntries(Array.from({ length: count }, (_, index) => {
      const id = `a${index}`;
      return [id, { id, kind: "video", duration: 2_000 }];
    })),
  };
}

describe("media recovery", () => {
  beforeEach(() => {
    clearAssetUrls();
    vi.resetAllMocks();
    vi.mocked(isOpfsAvailable).mockReturnValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns immediately for an empty project without opening storage", async () => {
    expect(await restoreMedia(emptyTimeline())).toEqual({ restored: 0, missing: 0, warning: null });
    expect(isOpfsAvailable).not.toHaveBeenCalled();
    expect(readMediaUrl).not.toHaveBeenCalled();
  });

  it("reports unavailable storage without trying to read files", async () => {
    vi.mocked(isOpfsAvailable).mockReturnValue(false);
    expect(await restoreMedia(withAssets(2))).toEqual({
      restored: 0,
      missing: 2,
      warning: "this browser has no private file system — stored media cannot be restored",
    });
    expect(readMediaUrl).not.toHaveBeenCalled();
  });

  it("bounds concurrent reads and publishes out-of-order results together", async () => {
    registerAssetUrl("existing", "blob:live");
    const previous = useAssetUrls.getState();
    let active = 0;
    let maxActive = 0;
    const finished: string[] = [];
    vi.mocked(readMediaUrl).mockImplementation(async (id) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, id === "a0" ? 15 : 1));
      active -= 1;
      finished.push(id);
      return `blob:${id}`;
    });
    const listener = vi.fn();
    const unsubscribe = useAssetUrls.subscribe(listener);
    try {
      expect(await restoreMedia(withAssets(10))).toEqual({ restored: 10, missing: 0, warning: null });
      expect(maxActive).toBe(4);
      expect(finished[0]).not.toBe("a0");
      expect(readMediaUrl).toHaveBeenCalledTimes(10);
      expect(listener).toHaveBeenCalledTimes(1);
      for (let index = 0; index < 10; index += 1) {
        expect(resolveAssetUrl(`a${index}`)).toBe(`blob:a${index}`);
      }
      expect(resolveAssetUrl("existing")).toBe("blob:live");
      expect([...previous]).toEqual([["existing", "blob:live"]]);
    } finally {
      unsubscribe();
    }
  });

  it("counts missing files and failed reads without losing successful files", async () => {
    vi.mocked(readMediaUrl).mockImplementation(async (id) => {
      if (id === "a0") return null;
      if (id === "a1") throw new Error("storage read failed");
      return `blob:${id}`;
    });
    expect(await restoreMedia(withAssets(3))).toEqual({
      restored: 1, missing: 2, warning: "2 of 3 stored media file(s) are not on disk",
    });
    expect(resolveAssetUrl("a0")).toBeUndefined();
    expect(resolveAssetUrl("a1")).toBeUndefined();
    expect(resolveAssetUrl("a2")).toBe("blob:a2");
  });

  it("does not publish when all stored files are missing", async () => {
    vi.mocked(readMediaUrl).mockResolvedValue(null);
    const listener = vi.fn();
    const unsubscribe = useAssetUrls.subscribe(listener);
    try {
      expect(await restoreMedia(withAssets(2))).toEqual({
        restored: 0, missing: 2, warning: "2 of 2 stored media file(s) are not on disk",
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("does not start storage reads when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await restoreMedia(withAssets(3), controller.signal)).toEqual({ restored: 0, missing: 0, warning: null });
    expect(readMediaUrl).not.toHaveBeenCalled();
    expect(isOpfsAvailable).not.toHaveBeenCalled();
  });

  it("stops new reads and revokes only unpublished URLs after cancellation", async () => {
    registerAssetUrl("existing", "blob:live");
    const previous = useAssetUrls.getState();
    const release: (() => void)[] = [];
    vi.mocked(readMediaUrl).mockImplementation((id) => new Promise((resolve) => {
      release.push(() => resolve(`blob:${id}`));
    }));
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const controller = new AbortController();
    const result = restoreMedia(withAssets(10), controller.signal);
    expect(readMediaUrl).toHaveBeenCalledTimes(4);
    controller.abort();
    for (const resolve of release) resolve();
    expect(await result).toEqual({ restored: 0, missing: 0, warning: null });
    expect(readMediaUrl).toHaveBeenCalledTimes(4);
    expect(revoke.mock.calls.flat().sort()).toEqual(["blob:a0", "blob:a1", "blob:a2", "blob:a3"]);
    expect(useAssetUrls.getState()).toBe(previous);
    expect(resolveAssetUrl("existing")).toBe("blob:live");
  });

  it("keeps live URLs valid when recovered media replaces their registry entries", async () => {
    registerAssetUrl("a0", "blob:live");
    vi.mocked(readMediaUrl).mockResolvedValue("blob:restored");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    expect(await restoreMedia(withAssets(1))).toEqual({ restored: 1, missing: 0, warning: null });
    expect(resolveAssetUrl("a0")).toBe("blob:restored");
    expect(revoke).not.toHaveBeenCalled();
  });

  it("releases completed URLs on abort before slower reads have finished", async () => {
    const release: (() => void)[] = [];
    vi.mocked(readMediaUrl).mockImplementation((id) => id === "a0"
      ? Promise.resolve("blob:a0")
      : new Promise((resolve) => release.push(() => resolve(`blob:${id}`))));
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const controller = new AbortController();
    const recovery = restoreMedia(withAssets(5), controller.signal);
    await vi.waitFor(() => expect(readMediaUrl).toHaveBeenCalledTimes(5));
    controller.abort();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:a0");
    expect(useAssetUrls.getState().size).toBe(0);
    for (const resolve of release) resolve();
    await recovery;
    expect(revoke.mock.calls.flat().sort()).toEqual(["blob:a0", "blob:a1", "blob:a2", "blob:a3", "blob:a4"]);
  });
});
