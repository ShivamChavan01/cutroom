import { afterEach, describe, expect, it, vi } from "vitest";
import { audioPeaks, decodeWaveform, ensureWaveform, useWaveforms, waveformPath } from "./waveform";

afterEach(() => vi.unstubAllGlobals());
describe("waveform samples and geometry", () => {
  it("preserves opposite-phase stereo peaks rather than cancelling channels", () => {
    const result = audioPeaks([new Float32Array([0, 0.5, 0, -1]), new Float32Array([0, -0.5, 0, 1])], 2);
    expect(result.durationMs).toBe(2000);
    expect(result.max).toBe(1);
    expect(Math.max(...result.peaks)).toBe(1);
  });
  it("handles silence and rejects missing or inconsistent audio", () => {
    expect(audioPeaks([new Float32Array(8)], 8).max).toBe(0);
    expect(() => audioPeaks([], 8)).toThrow();
    expect(() => audioPeaks([new Float32Array(1)], 0)).toThrow();
    expect(() => audioPeaks([new Float32Array(1), new Float32Array(2)], 8)).toThrow();
    expect(audioPeaks([new Float32Array([NaN, Infinity, 2])], 3).max).toBe(1);
  });
  it("draws the source range, scales gain, preserves silent parts and bounds SVG work", () => {
    const waveform = { durationMs: 4000, peaks: new Float32Array([0, 0, 1, 1]), max: 1 };
    expect(waveformPath(waveform, { inPoint: 0, duration: 1000, width: 3, volume: 1 })).toBe("M1.5,12.0V12.0");
    expect(waveformPath(waveform, { inPoint: 2000, duration: 1000, width: 3, volume: 1 })).toBe("M1.5,2.0V22.0");
    expect(waveformPath(waveform, { inPoint: 2000, duration: 1000, width: 3, volume: 0.5 })).toBe("M1.5,7.0V17.0");
    expect(waveformPath(waveform, { inPoint: 5000, duration: 1000, width: 3, volume: 1 })).toBe("M1.5,12.0V12.0");
    expect(waveformPath(waveform, { inPoint: 0, duration: 4000, width: 100_000, volume: 1 }).match(/M/g)).toHaveLength(2000);
    expect(waveformPath(waveform, { inPoint: -1, duration: 1000, width: 3, volume: 1 })).toBe("");
  });
});

function decoder(samples = new Float32Array([0, 0.5, -0.25, 1])) {
  const decodeAudioData = vi.fn(async () => ({ duration: 1, numberOfChannels: 1, sampleRate: 4, getChannelData: () => samples }));
  const context = vi.fn(function () { return { decodeAudioData }; });
  vi.stubGlobal("OfflineAudioContext", context);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal("fetch", fetcher);
  return { context, decodeAudioData, fetcher };
}
describe("waveform decoding and shared cache", () => {
  it("decodes without attaching an audio output node and handles aborted or failed fetches", async () => {
    const mocks = decoder();
    expect((await decodeWaveform("blob:a", new AbortController().signal)).max).toBe(1);
    expect(mocks.context).toHaveBeenCalledWith(1, 1, 8000);
    const controller = new AbortController(); controller.abort();
    await expect(decodeWaveform("blob:a", controller.signal)).rejects.toThrow();
    mocks.fetcher.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(decodeWaveform("blob:a", new AbortController().signal)).rejects.toThrow("read audio");
    mocks.fetcher.mockResolvedValueOnce(new Response("", { headers: { "content-length": String(129 * 1024 * 1024) } }));
    await expect(decodeWaveform("blob:a", new AbortController().signal)).rejects.toThrow("128 MB");
  });
  it("shares one job between repeated clips and rejects oversized assets before fetching", async () => {
    useWaveforms.setState(new Map(), true);
    const mocks = decoder();
    ensureWaveform("shared", "blob:shared", { duration: 1000 });
    ensureWaveform("shared", "blob:shared", { duration: 1000 });
    await vi.waitFor(() => expect(useWaveforms.getState().get("shared")?.status).toBe("ready"));
    expect(mocks.fetcher).toHaveBeenCalledOnce();
    ensureWaveform("large", "blob:large", { duration: 1000, bytes: 129 * 1024 * 1024 });
    expect(useWaveforms.getState().get("large")?.status).toBe("error");
    expect(mocks.fetcher).toHaveBeenCalledOnce();
  });
  it("serializes source decoding, ignores replaced jobs and records failures", async () => {
    useWaveforms.setState(new Map(), true);
    const mocks = decoder();
    ensureWaveform("replace", "blob:old", { duration: 1000 });
    ensureWaveform("replace", "blob:new", { duration: 1000 });
    ensureWaveform("second", "blob:second", { duration: 1000 });
    await vi.waitFor(() => expect(useWaveforms.getState().get("second")?.status).toBe("ready"));
    expect(mocks.fetcher.mock.calls.map(([url]) => url)).toEqual(["blob:new", "blob:second"]);
    mocks.fetcher.mockRejectedValueOnce(new Error("network"));
    ensureWaveform("fail", "blob:fail", { duration: 1000 });
    await vi.waitFor(() => expect(useWaveforms.getState().get("fail")?.status).toBe("error"));
  });
  it("evicts old completed entries while retaining bounded peak data and keeps the newest result", async () => {
    const waveform = audioPeaks([new Float32Array([0.5])], 1);
    useWaveforms.setState(new Map(Array.from({ length: 64 }, (_, i) => [String(i), { url: `blob:${i}`, status: "ready", waveform }])), true);
    decoder();
    ensureWaveform("new", "blob:new", { duration: 1000 });
    await vi.waitFor(() => expect(useWaveforms.getState().get("new")?.status).toBe("ready"));
    expect(useWaveforms.getState().size).toBe(64);
    expect(useWaveforms.getState().has("0")).toBe(false);
  });
});
