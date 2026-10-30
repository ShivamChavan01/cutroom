import {expect, it} from "vitest";
import {updatePlaybackErrors} from "./playbackErrors";
it("keeps a video error when unrelated audio becomes ready", () => {
  const failed = updatePlaybackErrors(new Map(), {kind: "failed", trackId: "v1", assetId: "video", message: "Could not decode video"});
  expect(updatePlaybackErrors(failed, {kind: "ready", trackId: "a1", assetId: "audio"})).toBe(failed);
  expect(updatePlaybackErrors(failed, {kind: "ready", trackId: "v1", assetId: "another-video"})).toBe(failed);
  expect(updatePlaybackErrors(failed, {kind: "ready", trackId: "v1", assetId: "video"}).size).toBe(0);
  expect(failed.size).toBe(1);
});
it("keeps independent failures and clears only the matching recovered source", () => {
  const video = updatePlaybackErrors(new Map(), {kind: "failed", trackId: "v1", assetId: "video", message: "video failed"});
  const both = updatePlaybackErrors(video, {kind: "failed", trackId: "a1", assetId: "audio", message: "audio failed"});
  const restored = updatePlaybackErrors(both, {kind: "ready", trackId: "v1", assetId: "video"});
  expect([...restored.keys()]).toEqual(["a1"]);
  expect(both.size).toBe(2);
});
