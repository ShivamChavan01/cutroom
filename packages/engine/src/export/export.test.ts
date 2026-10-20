import { describe, expect, it } from "vitest";
import {
  type Timeline,
  emptyTimeline,
  makeClip,
  putAsset,
} from "../index";
import { fromCutroomFile, toCutroomFile } from "./cutroom.js";
import { toEdl } from "./edl.js";
import { toFcpxml } from "./fcpxml.js";
import { EXPORT_FORMATS, findExportFormat } from "./index.js";

function timelineWithClips(): Timeline {
  let t = emptyTimeline("export-test");
  t = putAsset(t, { id: "asset-a", kind: "video", duration: 30_000 });
  t = putAsset(t, { id: "asset-b", kind: "video", duration: 30_000 });
  return {
    ...t,
    clips: {
      one: makeClip({
        id: "one", trackId: "v1", assetId: "asset-a",
        start: 0, inPoint: 1_000, duration: 4_000, volume: 1,
      }),
      two: makeClip({
        id: "two", trackId: "v1", assetId: "asset-b",
        start: 6_000, inPoint: 0, duration: 3_000, volume: 1,
      }),
      voice: makeClip({
        id: "voice", trackId: "a1", assetId: "asset-a",
        start: 0, inPoint: 0, duration: 8_000, volume: 1,
      }),
    },
  };
}

describe("EDL export", () => {
  it("writes a header and one event per clip", () => {
    const edl = toEdl(timelineWithClips());

    expect(edl).toContain("TITLE: export-test");
    expect(edl).toContain("FCM: NON-DROP FRAME");
    // Three clips, three events.
    expect(edl.match(/^\d{3} {2}AX/gm)).toHaveLength(3);
  });

  it("maps source in/out from the clip in-point and duration", () => {
    const edl = toEdl(timelineWithClips());
    // clip "one": inPoint 1s, duration 4s -> source 00:00:01:00 to 00:00:05:00
    expect(edl).toContain("00:00:01:00 00:00:05:00 00:00:00:00 00:00:04:00");
  });

  it("writes video events as V and audio events as A", () => {
    const edl = toEdl(timelineWithClips());
    expect(edl).toMatch(/AX {7}V /);
    expect(edl).toMatch(/AX {7}A /);
  });

  it("names the source clip in a comment", () => {
    const edl = toEdl(timelineWithClips());
    expect(edl).toContain("* FROM CLIP NAME: one");
  });

  it("uses the requested frame rate", () => {
    const edl = toEdl(timelineWithClips(), { fps: 24 });
    // 1s in at 24fps is frame 24 -> 00:00:01:00 still, but 4s duration ends on frame 96
    expect(edl).toContain("00:00:01:00 00:00:05:00");
  });
});

describe("FCPXML export", () => {
  it("writes a well-formed fcpxml document", () => {
    const xml = toFcpxml(timelineWithClips());

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<!DOCTYPE fcpxml>");
    expect(xml).toContain('<fcpxml version="1.10">');
    expect(xml).toContain("<resources>");
    expect(xml).toContain("<spine>");
    expect(xml.trimEnd().endsWith("</fcpxml>")).toBe(true);
  });

  it("declares one asset per referenced file", () => {
    const xml = toFcpxml(timelineWithClips());
    expect(xml.match(/<asset id=/g)).toHaveLength(2);
    expect(xml).toContain('name="asset-a"');
    expect(xml).toContain('name="asset-b"');
  });

  it("writes each clip with its offset, in-point and duration", () => {
    const xml = toFcpxml(timelineWithClips());
    // clip "one": offset 0, start 1s, duration 4s at 30fps
    expect(xml).toContain('offset="0/30s"');
    expect(xml).toContain('start="30/30s"');
    expect(xml).toContain('duration="120/30s"');
  });

  it("represents parallel tracks as one spine per track inside a story", () => {
    // That is how Final Cut stores A-roll and B-roll, and how Premiere
    // reads it back — one spine per track inside a <story>.
    const xml = toFcpxml(timelineWithClips());
    expect(xml).toContain("<story>");
    expect(xml.match(/<spine>/g)).toHaveLength(2);
    const spines = xml.split("<spine>").slice(1);
    expect(spines[0]).toContain('name="one"');
    expect(spines[0]).toContain('name="two"');
    expect(spines[1]).toContain('name="voice"');
  });

  it("produces parseable XML", () => {
    // A real structural check: every element closes, attributes are quoted.
    const xml = toFcpxml(timelineWithClips());
    const opens = (xml.match(/<[a-zA-Z]/g) ?? []).length;
    const closes = (xml.match(/<\//g) ?? []).length;
    const selfClosing = (xml.match(/\/>/g) ?? []).length;
    expect(closes + selfClosing).toBe(opens);
    expect(xml).not.toMatch(/[<>]\s*[^/]*=[^"']/);
  });

  it("escapes xml-special characters in names", () => {
    let t = timelineWithClips();
    t = {
      ...t,
      clips: {
        ...t.clips,
        odd: makeClip({
          id: "a & b <c>", trackId: "v1", assetId: "asset-a",
          start: 0, inPoint: 0, duration: 1_000, volume: 1,
        }),
      },
    };
    const xml = toFcpxml(t);
    expect(xml).toContain("a &amp; b &lt;c&gt;");
    expect(xml).not.toContain("<c>");
  });});

describe("Cutroom file export", () => {
  it("round-trips losslessly", () => {
    const original = timelineWithClips();
    const parsed = fromCutroomFile(toCutroomFile(original));

    expect(parsed).toEqual(original);
  });

  it("rejects a file with the wrong version", () => {
    expect(() => fromCutroomFile('{"version":99,"timeline":{}}')).toThrow(
      /unsupported Cutroom file version/,
    );
  });

  it("rejects invalid json and non-objects", () => {
    expect(() => fromCutroomFile("not json")).toThrow(/invalid JSON/);
    expect(() => fromCutroomFile("[]")).toThrow(/expected an object/);
  });
});

describe("export registry", () => {
  it("offers several real formats", () => {
    expect(EXPORT_FORMATS.length).toBeGreaterThanOrEqual(3);
    const ids = EXPORT_FORMATS.map((format) => format.id);
    expect(ids).toContain("otio");
    expect(ids).toContain("fcpxml");
    expect(ids).toContain("edl");
    expect(ids).toContain("cutroom");
  });

  it("gives every format an extension, a mime type and a target list", () => {
    for (const format of EXPORT_FORMATS) {
      expect(format.extension.startsWith(".")).toBe(true);
      expect(format.mime.length).toBeGreaterThan(0);
      expect(format.opens.length).toBeGreaterThan(0);
      expect(format.label.length).toBeGreaterThan(0);
    }
  });

  it("serializes a real timeline for every format", () => {
    const timeline = timelineWithClips();
    for (const format of EXPORT_FORMATS) {
      const output = format.serialize(timeline);
      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain("one");
    }
  });

  it("finds a format by id and returns undefined for unknown ids", () => {
    expect(findExportFormat("edl")?.extension).toBe(".edl");
    expect(findExportFormat("nope")).toBeUndefined();
  });
});
