import { beforeEach, expect, it, vi } from "vitest";
import { encodeEditingCopy } from "./encodeEditingCopy";

const fixture = vi.hoisted(() => ({
  execute: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), init: vi.fn(), tracks: vi.fn(),
}));
vi.mock("mediabunny", () => ({
  MP4: {}, QTFF: {}, MATROSKA: {}, WEBM: {}, QUALITY_HIGH: 100,
  Input: class { getVideoTracks = fixture.tracks; dispose = fixture.dispose; },
  Conversion: {init: fixture.init},
  Mp4OutputFormat: class {}, Output: class {}, StreamTarget: class {}, UrlSource: class {},
}));

function destination(existingBytes = 0) {
  const close = vi.fn(), abort = vi.fn();
  const getFile = vi.fn().mockResolvedValue({size: existingBytes});
  const createWritable = vi.fn().mockResolvedValue({close, abort});
  return {handle: {getFile, createWritable} as unknown as FileSystemFileHandle, close, abort, createWritable};
}

beforeEach(() => {
  vi.resetAllMocks();
  fixture.tracks.mockResolvedValue([{hasHighDynamicRange: async () => false, canBeTransparent: async () => false}]);
  fixture.init.mockResolvedValue({isValid: true, discardedTracks: [], execute: fixture.execute, cancel: fixture.cancel});
  fixture.cancel.mockResolvedValue(undefined);
});

it("writes a one-second keyframe interval at source size and commits a complete file", async () => {
  const file = destination();
  await encodeEditingCopy("blob:source", file.handle, new AbortController().signal, vi.fn());
  expect(fixture.init.mock.calls[0]?.[0].video).toEqual({codec: "avc", keyFrameInterval: 1, quality: 100});
  expect(file.close).toHaveBeenCalledOnce();
  expect(file.abort).not.toHaveBeenCalled();
  expect(fixture.dispose).toHaveBeenCalledOnce();
});

it("protects existing files and rejects a canceled picker before opening an encoder", async () => {
  const file = destination(3);
  await expect(encodeEditingCopy("source", file.handle, new AbortController().signal, vi.fn())).rejects.toThrow("new file name");
  await expect(encodeEditingCopy("source", file.handle, AbortSignal.abort(), vi.fn())).rejects.toThrow();
  expect(file.createWritable).not.toHaveBeenCalled();
});

it("keeps the source when the browser cannot retain all tracks or the encoder fails", async () => {
  const file = destination();
  fixture.init.mockResolvedValueOnce({isValid: true, discardedTracks: [{}]});
  await expect(encodeEditingCopy("source", file.handle, new AbortController().signal, vi.fn())).rejects.toThrow("all source tracks");
  fixture.execute.mockRejectedValueOnce(new Error("encoder unavailable"));
  await expect(encodeEditingCopy("source", file.handle, new AbortController().signal, vi.fn())).rejects.toThrow("encoder unavailable");
  expect(file.abort).toHaveBeenCalledTimes(2);
  expect(file.close).not.toHaveBeenCalled();
});

it("aborts the pending write on cancellation and leaves HDR or transparent originals untouched", async () => {
  const file = destination(), controller = new AbortController();
  fixture.execute.mockImplementationOnce(async () => controller.abort());
  await expect(encodeEditingCopy("source", file.handle, controller.signal, vi.fn())).rejects.toThrow();
  expect(fixture.cancel).toHaveBeenCalledOnce();
  expect(file.abort).toHaveBeenCalledOnce();
  fixture.tracks.mockResolvedValueOnce([{hasHighDynamicRange: async () => true}]);
  await expect(encodeEditingCopy("source", file.handle, new AbortController().signal, vi.fn())).rejects.toThrow("SDR");
  expect(file.createWritable).toHaveBeenCalledTimes(1);
});
