import {expect, it} from "vitest";
import {conflictKey, emptyTimeline, makeClip, mergeTimelines, putAsset} from "@cutroom/engine";
import {isMergeResolution, resolveMerge} from "./mergeSession";

const base = putAsset(emptyTimeline(), {id: "media", name: "base", kind: "video", duration: 10000});
const clip = makeClip({id: "shot", assetId: "media", trackId: "v1", start: 0, inPoint: 0, duration: 1000, volume: 1});
const timeline = {...base, fps: 30, clips: {shot: clip}};
it("replays field, deletion, project and metadata choices through the existing resolvers", () => {
  const cases = [
    mergeTimelines(timeline, {...timeline, clips: {shot: {...clip, start: 1000}}}, {...timeline, clips: {shot: {...clip, start: 2000}}}),
    mergeTimelines(timeline, {...timeline, clips: {}}, {...timeline, clips: {shot: {...clip, volume: .5}}}),
    mergeTimelines(timeline, {...timeline, fps: 25}, {...timeline, fps: 24}),
    mergeTimelines(timeline, {...timeline, assets: {media: {...base.assets.media!, name: "ours"}}}, {...timeline, assets: {media: {...base.assets.media!, name: "theirs"}}}),
    mergeTimelines(timeline, {...timeline, tracks: timeline.tracks.map(t => ({...t, name: "ours"}))}, {...timeline, tracks: timeline.tracks.map(t => ({...t, name: "theirs"}))}),
  ];
  for (let result of cases) {
    for (const conflict of [...result.conflicts]) {
      result = resolveMerge(result, {key: conflictKey(conflict), choice: conflict.kind === "deleteModify" ? "keep" : "theirs"});
    }
    expect(result.clean).toBe(true);
  }
  const deletion = cases[1]!;
  expect(resolveMerge(deletion, {key: conflictKey(deletion.conflicts[0]!), choice: "remove"}).merged.clips.shot).toBeUndefined();
});
it("validates recorded decision shapes and rejects stale keys and inappropriate choices", () => {
  for (const value of [null, [], {}, {key: "", choice: "a"}, {key: "conflict", choice: "pretend"}]) expect(isMergeResolution(value)).toBe(false);
  expect(isMergeResolution({key: "conflict", choice: "a"})).toBe(true);
  const result = mergeTimelines(timeline, {...timeline, fps: 25}, {...timeline, fps: 24});
  expect(() => resolveMerge(result, {key: "missing", choice: "ours"})).toThrow(/no longer/);
  expect(() => resolveMerge(result, {key: conflictKey(result.conflicts[0]!), choice: "a"})).toThrow(/does not apply/);
});
