import { describe, expect, it } from "vitest";
import { emptyTimeline, type Timeline } from "./model";
import { applyOp, makeClip, putAsset } from "./ops";
import { createHistory, current, record, redo, undo, authorsByClip } from "./history";
import { diffTimelines, isUnchanged } from "./diff";
import { mergeTimelines, resolveField, resolveProject } from "./merge";
import { fromOTIO, toOTIO } from "./otio";
import { fromCutroomFile, toCutroomFile } from "./export/cutroom";
import { toEdl } from "./export/edl";
import { toFcpxml } from "./export/fcpxml";

function fixture(): Timeline {
  const timeline = putAsset(emptyTimeline("editor"), {
    id: "source", kind: "video", duration: 10_000, name: "mountains.mp4", mimeType: "video/mp4", tags: ["Landscape"], width: 1920, height: 1080,
  });
  return applyOp(timeline, { type: "addClip", clip: makeClip({ id: "clip", trackId: "v1", assetId: "source", start: 0, inPoint: 0, duration: 4_000, volume: 1 }) });
}

describe("editor controls in the timeline model", () => {
  it("records transform changes and preserves them through undo and redo", () => {
    const base = fixture();
    const history = record(createHistory(base), { type: "setTransform", clipId: "clip", x: 120, y: -40, scaleX: 1.25, scaleY: 0.75, rotation: 15 }, "editor");
    expect(current(history).clips.clip).toMatchObject({ x: 120, y: -40, scaleX: 1.25, scaleY: 0.75, rotation: 15 });
    expect(current(undo(history))).toEqual(base);
    expect(current(redo(undo(history)))).toEqual(current(history));
    expect(authorsByClip(history).get("clip")).toBe("editor");
  });

  it.each([
    { x: Number.NaN }, { y: Number.POSITIVE_INFINITY }, { rotation: Number.NaN }, { scaleX: 0 }, { scaleY: -1 }, { scaleX: 21 },
  ])("rejects invalid transform %j", (transform) => {
    expect(() => applyOp(fixture(), { type: "setTransform", clipId: "clip", ...transform })).toThrow();
  });

  it("treats absent transforms and explicit identity transforms as equal", () => {
    const base = fixture();
    const explicit = applyOp(base, { type: "setTransform", clipId: "clip", x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(diffTimelines(base, explicit).changes).toEqual([]);
    expect(isUnchanged(base, explicit)).toBe(true);
    expect(mergeTimelines(base, base, explicit).clean).toBe(true);
  });

  it("diffs transformed clips and merges independent transform axes", () => {
    const base = fixture();
    const ours = applyOp(base, { type: "setTransform", clipId: "clip", x: 50 });
    const theirs = applyOp(base, { type: "setTransform", clipId: "clip", y: 60 });
    expect(diffTimelines(base, ours).changes[0]).toMatchObject({ kind: "edited", fields: ["x"] });
    expect(mergeTimelines(base, ours, theirs)).toMatchObject({ clean: true, merged: { clips: { clip: { x: 50, y: 60 } } } });
  });

  it("surfaces and resolves conflicting transform edits", () => {
    const base = fixture();
    const result = mergeTimelines(base, applyOp(base, { type: "setTransform", clipId: "clip", rotation: 10 }), applyOp(base, { type: "setTransform", clipId: "clip", rotation: 20 }));
    expect(result.conflicts).toContainEqual(expect.objectContaining({ kind: "field", field: "rotation", base: 0, ours: 10, theirs: 20 }));
    const resolved = resolveField(result, "clip", "rotation", "theirs");
    expect(resolved.merged.clips.clip?.rotation).toBe(20);
    expect(resolved.clean).toBe(true);
  });

  it("preserves transforms when splitting clips", () => {
    const transformed = applyOp(fixture(), { type: "setTransform", clipId: "clip", scaleX: 2, rotation: 30 });
    const split = applyOp(transformed, { type: "splitClip", clipId: "clip", at: 1_000 });
    expect(Object.values(split.clips).every((clip) => clip.scaleX === 2 && clip.rotation === 30)).toBe(true);
  });

  it("adds canonical tracks idempotently and replays them through history", () => {
    const op = { type: "addTrack", track: { id: "v2", name: "V2", kind: "video", muted: false } } as const;
    const base = fixture();
    const added = applyOp(base, op);
    expect(applyOp(added, op)).toEqual(added);
    expect(current(undo(record(createHistory(base), op, "editor")))).toEqual(base);
    expect(authorsByClip(record(createHistory(base), op, "editor")).size).toBe(0);
    expect(diffTimelines(base, added).metadataChanges).toContain("tracks");
  });

  it.each(["oops", "a2", "v0"])("rejects invalid video track id %s", (id) => {
    expect(() => applyOp(fixture(), { type: "addTrack", track: { id, kind: "video", name: "Video", muted: false } })).toThrow();
  });

  it("merges tracks and imported assets before testing clip overlap", () => {
    const base = fixture();
    let theirs = applyOp(base, { type: "addTrack", track: { id: "v2", name: "V2", kind: "video", muted: false } });
    theirs = putAsset(theirs, { id: "graphic", kind: "image", duration: 5_000, name: "title.png", mimeType: "image/png" });
    theirs = applyOp(theirs, { type: "addClip", clip: makeClip({ id: "title", trackId: "v2", assetId: "graphic", start: 0, inPoint: 0, duration: 5_000, volume: 1 }) });
    const result = mergeTimelines(base, base, theirs);
    expect(result.clean).toBe(true);
    expect(result.merged.tracks.some((track) => track.id === "v2")).toBe(true);
    expect(result.merged.assets.graphic?.kind).toBe("image");
    expect(result.merged.clips.title?.trackId).toBe("v2");
  });

  it("renames projects and changes frame rate through history", () => {
    let history = createHistory(fixture());
    history = record(history, { type: "renameProject", name: "  The quiet north  " }, "editor");
    history = record(history, { type: "setFrameRate", fps: 24 }, "editor");
    expect(current(history)).toMatchObject({ id: "The quiet north", fps: 24 });
    expect(current(undo(history)).fps).toBeUndefined();
    expect(diffTimelines(fixture(), current(history)).metadataChanges).toEqual(["id", "fps"]);
    expect(isUnchanged(fixture(), current(history))).toBe(false);
    expect(authorsByClip(history).size).toBe(0);
  });

  it.each([0, -1, 121, 23.976, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid frame rate %s", (fps) => {
    expect(() => applyOp(fixture(), { type: "setFrameRate", fps })).toThrow();
  });

  it.each(["", "   ", "x".repeat(201)])("rejects invalid project name", (name) => {
    expect(() => applyOp(fixture(), { type: "renameProject", name })).toThrow();
  });

  it("merges independent project settings and explicitly resolves divergent frame rates", () => {
    const base = fixture();
    const ours = applyOp(base, { type: "renameProject", name: "New name" });
    const theirs = applyOp(base, { type: "setFrameRate", fps: 24 });
    expect(mergeTimelines(base, ours, theirs)).toMatchObject({ clean: true, merged: { id: "New name", fps: 24 } });
    const conflict = mergeTimelines(base, applyOp(base, { type: "setFrameRate", fps: 25 }), theirs);
    expect(conflict.conflicts).toContainEqual({ kind: "project", field: "fps", base: 30, ours: 25, theirs: 24 });
    expect(resolveProject(conflict, "fps", "theirs")).toMatchObject({ clean: true, merged: { fps: 24 } });
  });

  it("round-trips transforms, project settings and image metadata in native files and OTIO", () => {
    let timeline = putAsset(fixture(), { id: "graphic", kind: "image", duration: 5_000, name: "title.png", mimeType: "image/png", tags: ["Titles"] });
    timeline = applyOp(timeline, { type: "setTransform", clipId: "clip", x: 20, scaleY: 1.5 });
    timeline = applyOp(timeline, { type: "setFrameRate", fps: 24 });
    expect(fromCutroomFile(toCutroomFile(timeline))).toEqual(timeline);
    expect(fromOTIO(toOTIO(timeline))).toEqual(timeline);
  });

  it("uses the project frame rate in interchange exports unless overridden", () => {
    let timeline = applyOp(fixture(), { type: "trimClip", clipId: "clip", inPoint: 500, duration: 1_000 });
    timeline = applyOp(timeline, { type: "setFrameRate", fps: 24 });
    expect(toEdl(timeline)).toContain("00:00:00:12");
    expect(toEdl(timeline, { fps: 30 })).toContain("00:00:00:15");
    expect(toFcpxml(timeline)).toContain('frameDuration="1/24s"');
    expect(toFcpxml(timeline, { fps: 25 })).toContain('frameDuration="1/25s"');
  });

  it("replays a JSON-persisted history containing the new editor operations", () => {
    let history = createHistory(fixture());
    history = record(history, { type: "setTransform", clipId: "clip", scaleX: 1.5, x: 24 }, "editor");
    history = record(history, { type: "addTrack", track: { id: "v2", name: "V2", kind: "video", muted: false } }, "editor");
    history = record(history, { type: "renameProject", name: "New cut" }, "editor");
    history = record(history, { type: "setFrameRate", fps: 25 }, "editor");
    expect(current(JSON.parse(JSON.stringify(history)))).toEqual(current(history));
  });

  it("detects asset metadata edits without depending on record insertion order", () => {
    const base = fixture();
    const asset = base.assets.source;
    if (asset === undefined) throw new Error("missing source fixture");
    const renamed = putAsset(base, { ...asset, name: "Renamed source.mp4" });
    expect(diffTimelines(base, renamed).metadataChanges).toEqual(["assets"]);
    expect(isUnchanged(base, renamed)).toBe(false);
    expect(diffTimelines(base, { ...base, fps: 30 }).metadataChanges).toEqual([]);
  });

  it("preserves one-sided media tags and source metadata through a merge", () => {
    const base = fixture();
    const source = base.assets.source!;
    const theirs = putAsset(base, { ...source, name: "North.mp4", tags: ["B-roll"] });
    const result = mergeTimelines(base, base, theirs);
    expect(result.clean).toBe(true);
    expect(result.merged.assets.source).toMatchObject({ name: "North.mp4", tags: ["B-roll"] });
    expect(mergeTimelines(base, theirs, base).merged.assets.source).toEqual(result.merged.assets.source);
    expect(base.assets.source?.tags).toEqual(["Landscape"]);
  });

  it("combines independent tag additions and preserves removals from either branch", () => {
    const base = fixture();
    const source = base.assets.source!;
    const ours = putAsset(base, { ...source, tags: ["Mountains"] });
    const theirs = putAsset(base, { ...source, tags: ["Landscape", "B-roll"] });
    expect(mergeTimelines(base, ours, theirs).merged.assets.source?.tags).toEqual(["Mountains", "B-roll"]);
    expect(mergeTimelines(base, theirs, ours).merged.assets.source?.tags).toEqual(["B-roll", "Mountains"]);
    const cleared = putAsset(base, { ...source, tags: [] });
    expect(mergeTimelines(base, base, cleared).merged.assets.source?.tags).toEqual([]);
  });

  it("keeps independent source metadata changes and uses ours for concurrent scalar changes", () => {
    const base = fixture();
    const source = base.assets.source!;
    const ours = putAsset(base, { ...source, name: "Our name.mp4" });
    const theirs = putAsset(base, { ...source, name: "Their name.mp4", proxyId: "proxy" });
    expect(mergeTimelines(base, ours, theirs).merged.assets.source).toMatchObject({ name: "Our name.mp4", proxyId: "proxy" });
  });

  it("keeps newly imported assets and combines tags on concurrent imports of the same source", () => {
    const base = fixture();
    const graphic = { id: "graphic", kind: "image", duration: 5_000 } as const;
    const ours = putAsset(base, { ...graphic, tags: ["Titles"] });
    const theirs = putAsset(putAsset(base, { ...graphic, tags: ["Overlay"] }), { id: "music", kind: "audio", duration: 2_000 });
    const assets = mergeTimelines(base, ours, theirs).merged.assets;
    expect(assets.graphic?.tags).toEqual(["Titles", "Overlay"]);
    expect(assets.music?.kind).toBe("audio");
    expect(mergeTimelines(base, base, ours).merged.assets.graphic).toEqual(ours.assets.graphic);
  });
});
