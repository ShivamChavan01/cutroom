import { create } from "zustand";

export const useMediaPosters = create<ReadonlyMap<string, string>>(() => new Map());

export function registerMediaPoster(assetId: string, image: string): void {
  useMediaPosters.setState((previous) => {
    const posters = new Map(previous);
    posters.delete(assetId);
    posters.set(assetId, image);
    if (posters.size > 64) {
      const oldest = posters.keys().next().value;
      if (oldest !== undefined) posters.delete(oldest);
    }
    return posters;
  }, true);
}

interface PosterOptions {
  readonly url: string;
  readonly signal?: AbortSignal;
}

export function createMediaPoster({ url, signal }: PosterOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Poster request aborted", "AbortError"));
      return;
    }
    const video = document.createElement("video");
    let settled = false;
    let targetTime = 0;
    const timer = setTimeout(() => fail(new Error("Poster decoding timed out")), 10_000);

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = (): void => fail(new DOMException("Poster request aborted", "AbortError"));
    const capture = (): void => {
      if (settled || video.seeking || video.readyState < 2) return;
      try {
        if (video.videoWidth <= 0 || video.videoHeight <= 0) {
          throw new Error("Video has no decoded frame");
        }
        const scale = Math.min(320 / video.videoWidth, 180 / video.videoHeight, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("Poster canvas is unavailable");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", 0.75);
        settled = true;
        cleanup();
        resolve(image);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Could not read video frame"));
      }
    };

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        fail(new Error("Video duration is unavailable"));
        return;
      }
      targetTime = Math.min(1, video.duration / 3);
      video.currentTime = targetTime;
    };
    video.onloadeddata = () => {
      if (Math.abs(video.currentTime - targetTime) < 0.01) capture();
    };
    video.onseeked = capture;
    video.onerror = () => fail(new Error("Could not decode video poster"));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      video.src = url;
    } catch (error) {
      fail(error instanceof Error ? error : new Error("Could not load video poster"));
    }
  });
}
