import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMediaPoster, registerMediaPoster, useMediaPosters } from "./poster";

class ProbeVideo {
  src = "";
  preload = "";
  muted = false;
  playsInline = false;
  duration = 6;
  currentTime = 0;
  readyState = 2;
  seeking = false;
  videoWidth = 1280;
  videoHeight = 720;
  onloadedmetadata: (() => void) | null = null;
  onloadeddata: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  load = vi.fn();

  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
}

describe("media poster extraction", () => {
  let video: ProbeVideo;
  let canvas: {
    width: number;
    height: number;
    getContext: ReturnType<typeof vi.fn>;
    toDataURL: ReturnType<typeof vi.fn>;
  };
  const drawImage = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    video = new ProbeVideo();
    canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toDataURL: vi.fn(() => "data:image/jpeg;base64,frame"),
    };
    vi.stubGlobal("document", {
      createElement: (tag: string) => tag === "video" ? video : canvas,
    });
    drawImage.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("extracts a bounded frame and releases the decoder without revoking its source", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const pending = createMediaPoster({ url: "blob:source" });
    video.onloadedmetadata?.();
    expect(video.currentTime).toBe(1);
    video.onseeked?.();

    expect(await pending).toBe("data:image/jpeg;base64,frame");
    expect([canvas.width, canvas.height]).toEqual([320, 180]);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 320, 180);
    expect(video.src).toBe("");
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.load).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    revoke.mockRestore();
  });

  it("seeks within a short video and preserves portrait proportions", async () => {
    video.duration = 0.3;
    video.videoWidth = 600;
    video.videoHeight = 1200;
    const pending = createMediaPoster({ url: "blob:portrait" });
    video.onloadedmetadata?.();
    expect(video.currentTime).toBeCloseTo(0.1);
    video.onseeked?.();
    await pending;
    expect([canvas.width, canvas.height]).toEqual([90, 180]);
  });

  it("does not upscale a small source frame", async () => {
    video.videoWidth = 80;
    video.videoHeight = 40;
    const pending = createMediaPoster({ url: "blob:small" });
    video.onloadedmetadata?.();
    video.onseeked?.();
    await pending;
    expect([canvas.width, canvas.height]).toEqual([80, 40]);
  });

  it("waits for decoded data rather than reading an unready frame", async () => {
    video.readyState = 1;
    const pending = createMediaPoster({ url: "blob:waiting" });
    video.onloadedmetadata?.();
    video.onseeked?.();
    expect(drawImage).not.toHaveBeenCalled();
    video.readyState = 2;
    video.onloadeddata?.();
    await expect(pending).resolves.toContain("data:image/jpeg");
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid duration %s", async (duration) => {
    video.duration = duration;
    const pending = createMediaPoster({ url: "blob:invalid" });
    video.onloadedmetadata?.();
    await expect(pending).rejects.toThrow("duration is unavailable");
    expect(video.src).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up an aborted request", async () => {
    const controller = new AbortController();
    const pending = createMediaPoster({ url: "blob:aborted", signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(video.src).toBe("");
    expect(video.onloadedmetadata).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not load media for an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createMediaPoster({ url: "blob:unused", signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(video.src).toBe("");
    expect(video.load).not.toHaveBeenCalled();
  });

  it("releases a source that cannot decode", async () => {
    const pending = createMediaPoster({ url: "blob:bad" });
    video.onerror?.();
    await expect(pending).rejects.toThrow("Could not decode");
    expect(video.src).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports an unavailable canvas and releases the source", async () => {
    canvas.getContext.mockReturnValue(null);
    const pending = createMediaPoster({ url: "blob:no-canvas" });
    video.onloadedmetadata?.();
    video.onseeked?.();
    await expect(pending).rejects.toThrow("canvas is unavailable");
    expect(video.src).toBe("");
  });

  it("times out media that never becomes ready", async () => {
    const pending = createMediaPoster({ url: "blob:stalled" });
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(video.src).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ready poster cache", () => {
  beforeEach(() => useMediaPosters.setState(new Map(), true));

  it("publishes a ready poster for its content asset id", () => {
    registerMediaPoster("asset-a", "data:a");
    expect(useMediaPosters.getState().get("asset-a")).toBe("data:a");
  });

  it("bounds retained frames and evicts the oldest entry", () => {
    for (let index = 0; index < 65; index++) registerMediaPoster(`asset-${index}`, `data:${index}`);
    expect(useMediaPosters.getState().size).toBe(64);
    expect(useMediaPosters.getState().has("asset-0")).toBe(false);
    expect(useMediaPosters.getState().get("asset-64")).toBe("data:64");
  });

  it("replaces one asset without mutating a previously published snapshot", () => {
    registerMediaPoster("asset-a", "data:old");
    const previous = useMediaPosters.getState();
    registerMediaPoster("asset-a", "data:new");
    expect(previous.get("asset-a")).toBe("data:old");
    expect(useMediaPosters.getState().get("asset-a")).toBe("data:new");
    expect(useMediaPosters.getState().size).toBe(1);
  });
});
