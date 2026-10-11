import { describe, expect, it } from "vitest";
import { applyOps, makeClip } from "./index";
import { fromOTIO, stringifyOTIO, toOTIO } from "./otio";
import { baseTimeline, clipOn } from "./fixtures.js";

describe("otio", () => {
  it("maps tracks to Video/Audio stacks with the right schema markers", () => {
    const doc = toOTIO(baseTimeline());

    expect(doc.OTIO_SCHEMA).toBe("Timeline.1");
    expect(doc.tracks.OTIO_SCHEMA).toBe("Stack.1");
    const video = doc.tracks.children.find((track) => track.name === "v1");
    expect(video?.OTIO_SCHEMA).toBe("Track.1");
    expect(video?.kind).toBe("Video");
    const audio = doc.tracks.children.find((track) => track.name === "a1");
    expect(audio?.kind).toBe("Audio");
    expect(video?.children[0]?.OTIO_SCHEMA).toBe("Clip.1");
  });

  it("maps clip fields to source_range exactly", () => {
    const doc = toOTIO(baseTimeline());
    const clip = doc.tracks.children[0]?.children[0];
    if (clip === undefined || clip.OTIO_SCHEMA !== "Clip.1") {
      throw new Error("expected a clip on v1");
    }

    expect(clip.name).toBe("c1");
    // start 0, inPoint 0, duration 10000ms at rate 1000.
    expect(clip.source_range.start_time).toEqual({
      "OTIO_SCHEMA": "RationalTime.1", rate: 1000, value: 0,
    });
    expect(clip.source_range.duration.value).toBe(10_000);
  });

  it("expresses timeline positions as gaps between clips", () => {
    // c1 ends at 10s; c2 starts at 12s — one 2000ms gap.
    const doc = toOTIO(clipOn(baseTimeline(), "c2", { start: 12_000 }));
    const children = doc.tracks.children[0]?.children ?? [];

    expect(children).toHaveLength(3);
    expect(children[1]).toMatchObject({ OTIO_SCHEMA: "Gap.1" });
    const gap = children[1];
    if (gap?.OTIO_SCHEMA !== "Gap.1") {
      throw new Error("expected a gap between the clips");
    }
    expect(gap.source_range.duration.value).toBe(2_000);
  });

  it("round-trips a gap-free timeline losslessly", () => {
    const original = applyOps(baseTimeline(), [
      { type: "moveClip", clipId: "c1", start: 2_000 },
    ]);
    const doc = toOTIO(original);
    const parsed = JSON.parse(JSON.stringify(doc)) as typeof doc;
    const imported = fromOTIO(parsed);

    expect(imported.clips.c1).toMatchObject({
      id: "c1",
      assetId: "asset-a",
      trackId: "v1",
      start: 2_000,
      inPoint: 0,
      duration: 10_000,
      outPoint: 10_000,
      volume: 1,
    });
  });

  it("round-trips in-points and volume through metadata", () => {
    const original = applyOps(baseTimeline(), [
      { type: "trimClip", clipId: "c1", inPoint: 1_500, duration: 5_000 },
      { type: "setVolume", clipId: "c1", volume: 0.25 },
    ]);
    const doc = JSON.parse(JSON.stringify(toOTIO(original)));
    const imported = fromOTIO(doc as ReturnType<typeof toOTIO>);

    expect(imported.clips.c1?.inPoint).toBe(1_500);
    expect(imported.clips.c1?.duration).toBe(5_000);
    expect(imported.clips.c1?.volume).toBe(0.25);
  });

  it("drops gaps on import but restores every clip's position", () => {
    const withGap = clipOn(baseTimeline(), "c2", { start: 12_000 });
    const doc = JSON.parse(JSON.stringify(toOTIO(withGap)));
    const imported = fromOTIO(doc as ReturnType<typeof toOTIO>);

    expect(imported.clips.c2?.start).toBe(12_000);
    expect(Object.keys(imported.clips)).toEqual(["c1", "c2"]);
  });

  it("falls back to the target URL basename for foreign OTIO", () => {
    const doc = {
      "OTIO_SCHEMA": "Timeline.1" as const,
      name: "foreign",
      global_start_time: { "OTIO_SCHEMA": "RationalTime.1" as const, rate: 24, value: 0 },
      metadata: {},
      tracks: {
        "OTIO_SCHEMA": "Stack.1" as const,
        name: "Tracks",
        children: [{
          "OTIO_SCHEMA": "Track.1" as const,
          kind: "Video" as const,
          name: "V1",
          children: [{
            OTIO_SCHEMA: "Clip.1" as const,
            name: "foreign-clip",
            source_range: {
              "OTIO_SCHEMA": "TimeRange.1" as const,
              start_time: { "OTIO_SCHEMA": "RationalTime.1" as const, rate: 24, value: 48 },
              duration: { "OTIO_SCHEMA": "RationalTime.1" as const, rate: 24, value: 24 },
            },
            media_reference: {
              "OTIO_SCHEMA": "ExternalReference.1" as const,
              target_url: "media/interview-take2.mov",
              available_range: {
                "OTIO_SCHEMA": "TimeRange.1" as const,
                start_time: { "OTIO_SCHEMA": "RationalTime.1" as const, rate: 24, value: 0 },
                duration: { "OTIO_SCHEMA": "RationalTime.1" as const, rate: 24, value: 240 },
              },
            },
            metadata: {},
          }],
        }],
      },
    };
    const imported = fromOTIO(doc as unknown as ReturnType<typeof toOTIO>);

    expect(imported.clips["foreign-clip"]).toBeDefined();
    // 48 ticks at 24 fps = 2s = 2000ms; 24 ticks = 1000ms.
    expect(imported.clips["foreign-clip"]?.inPoint).toBe(2_000);
    expect(imported.clips["foreign-clip"]?.duration).toBe(1_000);
    expect(imported.clips["foreign-clip"]?.assetId).toBe("interview-take2.mov");
    expect(imported.assets["interview-take2.mov"]?.duration).toBe(10_000);
    expect(imported.tracks[0]?.kind).toBe("video");
  });

  it("produces JSON a real editor could load", () => {
    // A structural smoke test of the serialized text itself.
    const json = stringifyOTIO(clipOn(baseTimeline(), "c2", { start: 10_000 }));
    const parsed = JSON.parse(json) as ReturnType<typeof toOTIO>;

    expect(parsed.OTIO_SCHEMA).toBe("Timeline.1");
    expect(parsed.tracks.children.length).toBe(2);
    expect(JSON.parse(json)).toHaveProperty("tracks.children[0].children");
  });

  it("empty timelines still serialize as valid stacks", () => {
    const doc = toOTIO({ ...baseTimeline(), clips: {} });
    expect(doc.tracks.children.every((track) => track.children.length === 0)).toBe(true);
  });

  it("keeps clips independent of insertion order on import", () => {
    const a = makeClip({
      id: "a", trackId: "v1", assetId: "asset-a",
      start: 0, inPoint: 0, duration: 4_000, volume: 1,
    });
    const b = { ...a, id: "b", start: 4_000 };
    const timeline = { ...baseTimeline(), clips: { b, a } };
    const doc = toOTIO(timeline);
    const children = doc.tracks.children[0]?.children ?? [];

    // Sorted by start on export regardless of record insertion order.
    expect(children.map((child) => child.OTIO_SCHEMA === "Clip.1" ? (child as { name: string }).name : "gap"))
      .toEqual(["a", "b"]);
  });
});
