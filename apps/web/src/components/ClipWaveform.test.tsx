import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ClipWaveform } from "./ClipWaveform";
import { registerAssetUrl, useAssetUrls } from "../lib/assets";
import { useWaveforms } from "../lib/media/waveform";
import { useUiStore } from "../uiStore";

vi.mock("../lib/assets", async (original) => {
  const actual = await original<typeof import("../lib/assets")>();
  return { ...actual, useAssetUrls: Object.assign(<T,>(selector: (value: ReturnType<typeof actual.useAssetUrls.getState>) => T) => selector(actual.useAssetUrls.getState()), { getState: actual.useAssetUrls.getState, setState: actual.useAssetUrls.setState }) };
});
vi.mock("../lib/media/waveform", async (original) => {
  const actual = await original<typeof import("../lib/media/waveform")>();
  return { ...actual, useWaveforms: Object.assign(<T,>(selector: (value: ReturnType<typeof actual.useWaveforms.getState>) => T) => selector(actual.useWaveforms.getState()), { getState: actual.useWaveforms.getState, setState: actual.useWaveforms.setState }) };
});
vi.mock("../uiStore", async (original) => {
  const actual = await original<typeof import("../uiStore")>();
  return { ...actual, useUiStore: Object.assign(<T,>(selector: (value: ReturnType<typeof actual.useUiStore.getState>) => T) => selector(actual.useUiStore.getState()), { setState: actual.useUiStore.setState }) };
});

const props = { asset: { id: "a", kind: "video", duration: 5000 } as const, trackId: "v1", start: 1000, inPoint: 500, duration: 4000, volume: 1, pxPerSecond: 50, visibleWindow: { start: 2000, end: 4000 } };
describe("clip waveforms", () => {
  beforeEach(() => {
    useAssetUrls.setState(new Map(), true);
    useWaveforms.setState(new Map(), true);
    useUiStore.setState({ mutedTrackIds: [] });
  });
  it("renders nothing without media, and a truthful loading/error state rather than fake peaks", () => {
    expect(renderToStaticMarkup(<ClipWaveform {...props} />)).toBe("");
    registerAssetUrl("a", "blob:a");
    expect(renderToStaticMarkup(<ClipWaveform {...props} />)).toContain("Analyzing audio");
    useWaveforms.setState(new Map([["a", { url: "blob:a", status: "error", message: "Unsupported audio" }]]), true);
    const html = renderToStaticMarkup(<ClipWaveform {...props} />);
    expect(html).toContain("Waveform unavailable");
    expect(html).not.toContain("<path");
  });
  it("maps viewport time into source offsets and draws only the visible width", () => {
    registerAssetUrl("a", "blob:a");
    useWaveforms.setState(new Map([["a", { url: "blob:a", status: "ready", waveform: { durationMs: 5000, max: 1, peaks: new Float32Array([0, 1, 0.5, 0.25, 0]) } }]]), true);
    const html = renderToStaticMarkup(<ClipWaveform {...props} />);
    expect(html).toContain('data-source-in="1500"');
    expect(html).toContain('data-source-duration="2000"');
    expect(html).toContain('viewBox="0 0 100 24"');
    expect(html).toContain("left:50px");
    expect(html).toContain('aria-label="Audio waveform"');
    expect(renderToStaticMarkup(<ClipWaveform {...props} visibleWindow={{ start: 10_000, end: 11_000 }} />)).toBe("");
  });
  it("uses audio lane styling, indicates silence, dims mute and discards stale URL data", () => {
    registerAssetUrl("a", "blob:a");
    useWaveforms.setState(new Map([["a", { url: "blob:a", status: "ready", waveform: { durationMs: 5000, max: 0, peaks: new Float32Array(5) } }]]), true);
    useUiStore.setState({ mutedTrackIds: ["a1"] });
    const html = renderToStaticMarkup(<ClipWaveform {...props} trackId="a1" />);
    expect(html).toContain("is-audio");
    expect(html).toContain("Silent audio");
    expect(html).toContain("opacity:0.35");
    registerAssetUrl("a", "blob:new");
    expect(renderToStaticMarkup(<ClipWaveform {...props} />)).not.toContain("<path");
  });
});
