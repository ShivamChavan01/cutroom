import { describe, expect, it } from "vitest";
import { type Asset, applyOp, emptyTimeline, putAsset } from "@cutroom/engine";
import { clipForMedia, filterMediaAssets, mediaLabel, mediaTags, parseMediaTags } from "./mediaLibrary";

const video: Asset = { id: "video-a", kind: "video", duration: 2_000, name: "Cabin.mp4", tags: ["Cabin", "B-roll"] };
const image: Asset = { id: "image-a", kind: "image", duration: 5_000, name: "Map.png", tags: ["Graphics"] };
const audio: Asset = { id: "audio-a", kind: "audio", duration: 3_000, name: "Narration.wav" };

describe("media library", () => {
  it("filters actual media by section, filename, identity and tags", () => {
    const assets = [video, image, audio];
    expect(filterMediaAssets(assets, { section: "footage", query: "", tag: "" })).toEqual([video, audio]);
    expect(filterMediaAssets(assets, { section: "graphics", query: " map ", tag: "" })).toEqual([image]);
    expect(filterMediaAssets(assets, { section: "footage", query: "VIDEO-A", tag: "Cabin" })).toEqual([video]);
    expect(filterMediaAssets(assets, { section: "footage", query: "b-ROLL", tag: "" })).toEqual([video]);
    expect(filterMediaAssets(assets, { section: "footage", query: "missing", tag: "" })).toEqual([]);
  });

  it("uses original filenames and falls back to readable ordinal labels", () => {
    expect(mediaLabel(video, 0)).toBe("Cabin.mp4");
    expect(mediaLabel({ id: "a", kind: "video", duration: 1_000 }, 1)).toBe("Video 02");
  });

  it("lists only the tags present in the project", () => {
    expect(mediaTags([video, image, video])).toEqual(["B-roll", "Cabin", "Graphics"]);
    expect(mediaTags([])).toEqual([]);
  });

  it("cleans comma-separated tags and rejects oversized input", () => {
    expect(parseMediaTags(" Cabin, cabin, B-roll, , ")).toEqual(["cabin", "B-roll"]);
    expect(parseMediaTags("")).toEqual([]);
    expect(() => parseMediaTags("x".repeat(41))).toThrow("40 characters");
    expect(() => parseMediaTags(Array.from({ length: 13 }, (_, i) => String(i)).join(","))).toThrow("12 tags");
  });

  it("appends distinct clips to matching video and audio tracks", () => {
    let timeline = putAsset(putAsset(emptyTimeline(), video), audio);
    const first = clipForMedia(timeline, video.id);
    timeline = applyOp(timeline, { type: "addClip", clip: first });
    const second = clipForMedia(timeline, video.id);
    expect(second.id).not.toBe(first.id);
    expect(second.start).toBe(2_000);
    expect(clipForMedia(timeline, audio.id).trackId).toBe("a1");
    expect(() => clipForMedia(timeline, "missing")).toThrow("no longer");
    expect(() => clipForMedia({ ...timeline, tracks: [] }, video.id)).toThrow("matching track");
  });
});
