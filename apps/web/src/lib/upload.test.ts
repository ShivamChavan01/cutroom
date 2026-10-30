import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyTimeline } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { clearAssetUrls, resolveAssetUrl } from "./assets";
import { uploadFiles } from "./upload";

let probeFails = false;
let imageFails = false;
let probeDuration = 2;
let probeHangs = false;
const allocatedUrls: string[] = [];

class ProbeVideo {
  private url = "";
  preload = "";
  duration = probeDuration;
  videoWidth = 1280;
  videoHeight = 720;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;

  get src(): string { return this.url; }

  set src(url: string) {
    this.url = url;
    if (probeHangs) return;
    queueMicrotask(() => {
      if (probeFails) this.onerror?.();
      else this.onloadedmetadata?.();
    });
  }

  removeAttribute(_name: string): void {}
  load(): void {}
}

class ProbeImage {
  naturalWidth = 1920;
  naturalHeight = 1080;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_url: string) {
    queueMicrotask(() => imageFails ? this.onerror?.() : this.onload?.());
  }

  removeAttribute(_name: string): void {}
}

describe("uploadFiles", () => {
  beforeEach(() => {
    probeFails = false;
    imageFails = false;
    probeDuration = 2;
    probeHangs = false;
    useEditorStore.getState().loadTimeline(emptyTimeline("upload-test"));
    clearAssetUrls();
    vi.stubGlobal("document", { createElement: () => new ProbeVideo() });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("Image", ProbeImage);
    const createObjectURL = URL.createObjectURL;
    vi.spyOn(URL, "createObjectURL").mockImplementation((file) => {
      const url = createObjectURL(file);
      allocatedUrls.push(url);
      return url;
    });
  });

  afterEach(() => {
    for (const url of allocatedUrls.splice(0)) URL.revokeObjectURL(url);
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearAssetUrls();
  });

  it("keeps the uploaded media readable after probing its duration", async () => {
    const file = new File(["video bytes"], "demo.mp4", { type: "video/mp4" });
    const report = await uploadFiles([file]);
    expect(report.skipped).toEqual([]);
    expect(report.added).toHaveLength(1);
    const clip = Object.values(useEditorStore.getState().timeline.clips)[0];
    expect(clip?.duration).toBe(2_000);
    expect(useEditorStore.getState().timeline.assets[clip?.assetId ?? ""]).toMatchObject({ name: "demo.mp4", mimeType: "video/mp4", width: 1280, height: 720 });
    const url = clip === undefined ? undefined : resolveAssetUrl(clip.assetId);
    expect(url).toBeDefined();
    const response = await fetch(url ?? "");
    expect(await response.text()).toBe("video bytes");
  });

  it("revokes a rejected upload and reports it without adding clips", async () => {
    probeFails = true;
    const file = new File(["bad media"], "bad.mp4");
    const report = await uploadFiles([file]);
    expect(report.added).toEqual([]);
    expect(report.skipped).toEqual([
      { name: "bad.mp4", reason: expect.stringContaining("cannot read") },
    ]);
    expect(useEditorStore.getState().timeline.clips).toEqual({});
    await expect(fetch(allocatedUrls[0] ?? "")).rejects.toThrow();
  });

  it("does nothing for an empty selection and clears upload status", async () => {
    const onStatus = vi.fn();
    expect(await uploadFiles([], onStatus)).toEqual({
      added: [], skipped: [], storageWarning: null,
    });
    expect(onStatus).toHaveBeenCalledExactlyOnceWith(null);
    expect(allocatedUrls).toEqual([]);
  });

  it("appends multiple uploads and reuses the asset for duplicate media", async () => {
    const file = new File(["video bytes"], "demo.mp4");
    const report = await uploadFiles([file, file]);
    expect(report.skipped).toEqual([]);
    expect(new Set(report.added).size).toBe(2);
    const timeline = useEditorStore.getState().timeline;
    expect(Object.keys(timeline.assets)).toHaveLength(1);
    expect(Object.values(timeline.clips).map((clip) => clip.start)).toEqual([0, 2_000]);
  });

  it("keeps all selected files when the picker clears during probing", async () => {
    const file = new File(["video bytes"], "demo.mp4");
    const files = [file, file];
    const pending = uploadFiles(files);
    files.length = 0;

    const report = await pending;
    expect(report.skipped).toEqual([]);
    expect(report.added).toHaveLength(2);
    expect(Object.values(useEditorStore.getState().timeline.clips).map((clip) => clip.start))
      .toEqual([0, 2_000]);
  });

  it("imports an image graphic with its natural dimensions and a finite display duration", async () => {
    const file = new File(["png bytes"], "Map.png", { type: "image/png" });
    const report = await uploadFiles([file]);
    expect(report.skipped).toEqual([]);
    const [asset] = Object.values(useEditorStore.getState().timeline.assets);
    expect(asset).toMatchObject({ kind: "image", name: "Map.png", duration: 5_000, width: 1920, height: 1080, mimeType: "image/png" });
    const [clip] = Object.values(useEditorStore.getState().timeline.clips);
    expect(clip).toMatchObject({ trackId: "v1", duration: 5_000 });
    expect(await (await fetch(resolveAssetUrl(asset?.id ?? "") ?? "")).text()).toBe("png bytes");
  });

  it("recognizes image extensions when a picker does not supply a MIME type", async () => {
    const report = await uploadFiles([new File(["png bytes"], "map.PNG")]);
    expect(report.skipped).toEqual([]);
    expect(Object.values(useEditorStore.getState().timeline.assets)[0]?.kind).toBe("image");
  });

  it("places an audio source on the audio track", async () => {
    const report = await uploadFiles([new File(["audio bytes"], "Voice.wav", { type: "audio/wav" })]);
    expect(report.skipped).toEqual([]);
    expect(Object.values(useEditorStore.getState().timeline.assets)[0]?.kind).toBe("audio");
    expect(Object.values(useEditorStore.getState().timeline.clips)[0]?.trackId).toBe("a1");
  });

  it("reports invalid images and live streams without adding unusable clips", async () => {
    imageFails = true;
    probeDuration = Infinity;
    const report = await uploadFiles([new File(["bad"], "bad.png"), new File(["live"], "live.mp4")]);
    expect(report.added).toEqual([]);
    expect(report.skipped.map((item) => item.name)).toEqual(["bad.png", "live.mp4"]);
    expect(useEditorStore.getState().timeline.clips).toEqual({});
    for (const url of allocatedUrls) await expect(fetch(url)).rejects.toThrow();
  });

  it("finishes with a skipped file when metadata decoding never completes", async () => {
    vi.useFakeTimers();
    probeHangs = true;
    const pending = uploadFiles([new File(["stalled"], "stalled.mp4")]);
    await vi.advanceTimersByTimeAsync(10_000);
    const report = await pending;
    expect(report.added).toEqual([]);
    expect(report.skipped).toEqual([{ name: "stalled.mp4", reason: expect.stringContaining("cannot read") }]);
    expect(useEditorStore.getState().timeline.clips).toEqual({});
  });

  it("duplicate import retains existing tags and original source metadata", async () => {
    const file = new File(["video bytes"], "first.mp4");
    await uploadFiles([file]);
    const source = Object.values(useEditorStore.getState().timeline.assets)[0]!;
    useEditorStore.getState().dispatch({type: "setAssetTags", assetId: source.id, tags: ["keep"]});
    const report = await uploadFiles([new File(["video bytes"], "renamed.mp4")]);
    expect(report.skipped).toEqual([]);
    expect(useEditorStore.getState().timeline.assets[source.id]).toMatchObject({name: "first.mp4", tags: ["keep"]});
  });
});
