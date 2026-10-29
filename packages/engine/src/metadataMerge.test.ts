import { describe, expect, it } from "vitest";
import { emptyTimeline, makeClip, mergeTimelines, type Timeline } from "./index";

function base(): Timeline {
  return { ...emptyTimeline(), assets: { media: { id: "media", kind: "video", duration: 10000, name: "original.mp4", tags: ["old"] } } };
}

describe("versioned metadata", () => {
  it("blocks divergent asset names instead of silently choosing ours", () => {
    const b = base();
    const ours = { ...b, assets: { media: { ...b.assets.media!, name: "interview.mp4" } } };
    const theirs = { ...b, assets: { media: { ...b.assets.media!, name: "customer-story.mp4" } } };
    const result = mergeTimelines(b, ours, theirs);
    expect(result.clean).toBe(false);
    expect(result.conflicts).toContainEqual(expect.objectContaining({ kind: "assetField", assetId: "media", field: "name", base: "original.mp4", ours: "interview.mp4", theirs: "customer-story.mp4" }));
  });
  it("merges independent track property changes", () => {
    const b = base();
    const ours = { ...b, tracks: b.tracks.map(t => t.id === "v1" ? { ...t, name: "Interview" } : t) };
    const theirs = { ...b, tracks: b.tracks.map(t => t.id === "v1" ? { ...t, muted: true } : t) };
    expect(mergeTimelines(b, ours, theirs).merged.tracks[0]).toEqual({ ...ours.tracks[0], muted: true });
  });
  it("blocks different properties for concurrent same-ID track additions", () => {
    const b = base();
    const t = { id: "v2", name: "Cutaways", kind: "video" as const, muted: false };
    const result = mergeTimelines(b, { ...b, tracks: [...b.tracks, t] }, { ...b, tracks: [...b.tracks, { ...t, name: "Titles" }] });
    expect(result.conflicts).toContainEqual(expect.objectContaining({ kind: "trackField", trackId: "v2", field: "name" }));
    expect(result.clean).toBe(false);
  });
  it("honors uncontested asset deletion and surfaces deletion versus modification", () => {
    const b = base();
    expect(mergeTimelines(b, { ...b, assets: {} }, b).merged.assets).toEqual({});
    const result = mergeTimelines(b, { ...b, assets: {} }, { ...b, assets: { media: { ...b.assets.media!, name: "changed" } } });
    expect(result.conflicts).toContainEqual(expect.objectContaining({ kind: "assetPresence", assetId: "media" }));
  });
  it("retains referenced metadata with a blocking presence decision", () => {
    const b = base();
    const clip = makeClip({ id: "c", assetId: "media", trackId: "v1", start: 0, inPoint: 0, duration: 1000, volume: 1 });
    const result = mergeTimelines(b, { ...b, assets: {}, tracks: b.tracks.slice(1) }, { ...b, clips: { c: clip } });
    expect(result.merged.assets.media).toBeDefined();
    expect(result.merged.tracks.some(t => t.id === "v1")).toBe(true);
    expect(result.clean).toBe(false);
  });
  it("honors a one-sided track reorder", () => {
    const b = base();
    expect(mergeTimelines(b, b, { ...b, tracks: [...b.tracks].reverse() }).merged.tracks.map(t => t.id)).toEqual(["a1", "v1"]);
  });
});

it("merges identical metadata changes and independent scalar changes without mutation", () => {
  const b = base();
  const o = { ...b, assets: { media: { ...b.assets.media!, name: "same", tags: ["new"] } } };
  const t = { ...b, assets: { media: { ...b.assets.media!, name: "same", width: 1920, tags: ["old", "other"] } } };
  const before = JSON.stringify([b, o, t]);
  const result = mergeTimelines(b, o, t);
  expect(result.clean).toBe(true);
  expect(result.merged.assets.media).toMatchObject({ name: "same", width: 1920, tags: ["new", "other"] });
  expect(JSON.stringify([b, o, t])).toBe(before);
  expect(mergeTimelines(b, o, t)).toEqual(result);
});
it("preserves the position of a one-sided new layer", () => {
  const b = base();
  const newTrack = { id: "v2", kind: "video" as const, name: "Overlay", muted: false };
  const theirs = { ...b, tracks: [newTrack, ...b.tracks] };
  expect(mergeTimelines(b, b, theirs).merged.tracks).toEqual(theirs.tracks);
});
it("surfaces incompatible ordering of shared new tracks", () => {
  const b = base();
  const v2 = { id: "v2", kind: "video" as const, name: "V2", muted: false };
  const v3 = { ...v2, id: "v3", name: "V3" };
  const r = mergeTimelines(b, { ...b, tracks: [...b.tracks, v2, v3] }, { ...b, tracks: [...b.tracks, v3, v2] });
  expect(r.conflicts.some(c => c.kind === "trackOrder")).toBe(true);
});

it.each([
  { ours: ["old"], theirs: [], expected: [] },
  { ours: [], theirs: [], expected: [] },
  { ours: ["old", "same"], theirs: ["old", "same"], expected: ["old", "same"] },
  { ours: ["old", "left"], theirs: ["right"], expected: ["left", "right"] },
])("merges tag membership against the base: $ours / $theirs", ({ ours, theirs, expected }) => {
  const b = base();
  const result = mergeTimelines(b, { ...b, assets: { media: { ...b.assets.media!, tags: ours } } }, { ...b, assets: { media: { ...b.assets.media!, tags: theirs } } });
  expect(result.clean).toBe(true);
  expect(result.merged.assets.media?.tags).toEqual(expected);
});

it("reports scalar disagreement for concurrent same-ID asset additions", () => {
  const b = emptyTimeline();
  const ours = { ...b, assets: { media: { id: "media", kind: "video" as const, duration: 1000, name: "ours" } } };
  const theirs = { ...ours, assets: { media: { ...ours.assets.media, name: "theirs" } } };
  const result = mergeTimelines(b, ours, theirs);
  expect(result.conflicts).toEqual([{ kind: "assetField", assetId: "media", field: "name", base: undefined, ours: "ours", theirs: "theirs" }]);
  expect(result.clean).toBe(false);
});

it("blocks both-side metadata deletion when a surviving clip still references it", () => {
  const b = base();
  const clip = makeClip({ id: "c", assetId: "media", trackId: "v1", start: 0, inPoint: 0, duration: 1000, volume: 1 });
  const branch = { ...b, assets: {}, tracks: b.tracks.slice(1), clips: { c: clip } };
  const result = mergeTimelines(b, branch, branch);
  expect(result.conflicts).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "assetPresence", assetId: "media", ours: undefined, theirs: undefined }),
    expect.objectContaining({ kind: "trackPresence", trackId: "v1", ours: undefined, theirs: undefined }),
  ]));
  expect(result.clean).toBe(false);
  expect(result.merged.assets.media).toEqual(b.assets.media);
  expect(result.merged.tracks.some(t => t.id === "v1")).toBe(true);
});
