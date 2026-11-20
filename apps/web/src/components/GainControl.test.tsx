import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyOp, emptyTimeline, makeClip, putAsset } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";
import { GainControl, GainSuggestion } from "./GainControl";

vi.mock("../store", async original => {
  const actual = await original<typeof import("../store")>();
  return { ...actual, useEditorStore: Object.assign(
    <T,>(selector: (state: ReturnType<typeof actual.useEditorStore.getState>) => T) => selector(actual.useEditorStore.getState()),
    { getState: actual.useEditorStore.getState },
  ) };
});

vi.mock("../uiStore", async original => {
  const actual = await original<typeof import("../uiStore")>();
  return { ...actual, useUiStore: Object.assign(
    <T,>(selector: (state: ReturnType<typeof actual.useUiStore.getState>) => T) => selector(actual.useUiStore.getState()),
    { getState: actual.useUiStore.getState, setState: actual.useUiStore.setState },
  ) };
});

function seed() {
  useUiStore.setState({ lockedTrackIds: [] });
  let timeline = putAsset(emptyTimeline("gain-ui"), { id: "music", name: "<music>", kind: "audio", duration: 4000 });
  for (const id of ["one", "two", "three", "four"]) timeline = applyOp(timeline, { type: "addClip", clip: makeClip({ id, assetId: "music", trackId: "a1", start: 0, inPoint: 0, duration: 1000, volume: 1 }) });
  const store = useEditorStore.getState();
  store.loadTimeline(timeline); store.setGainSuggestionsEnabled(true);
  for (const id of ["one", "two", "three"]) {
    store.selectClip(id); store.beginGainGesture(id); store.changeGain(id, 0.3); store.finishGainGesture(id);
  }
  store.selectClip("four");
}

describe("gain suggestion presentation", () => {
  beforeEach(seed);

  it("offers a reason and supporting edits before allowing application", () => {
    const before = useEditorStore.getState().timeline;
    const html = renderToStaticMarkup(<GainSuggestion />);
    expect(html).toContain("Match gain to 30%?");
    expect(html).toContain("last three gain edits");
    expect(html).toContain("Show supporting edits");
    expect(html).toContain("&lt;music&gt;");
    expect(html).toContain("Preview gain match");
    expect(html).toContain("Dismiss gain suggestion");
    expect(html).not.toContain("Apply gain match");
    expect(useEditorStore.getState().timeline).toBe(before);
  });

  it("renders the gain slider, optional suggestions and session guidance", () => {
    const clip = useEditorStore.getState().timeline.clips.four;
    if (clip === undefined) throw new Error("Missing clip");
    const html = renderToStaticMarkup(<GainControl clip={clip} disabled={false} onError={() => {}} />);
    expect(html).toContain('aria-label="Clip volume"');
    expect(html).toContain("Suggest gain matches");
    expect(html).toContain("this session&#x27;s edits");
    expect(html).toContain("100%");
  });

  it("renders nothing when evidence is weak, suggestions are disabled or a track is locked", () => {
    useUiStore.setState({ lockedTrackIds: ["a1"] });
    expect(renderToStaticMarkup(<GainSuggestion />)).toBe("");
    useUiStore.setState({ lockedTrackIds: [] });
    useEditorStore.getState().undo();
    expect(renderToStaticMarkup(<GainSuggestion />)).toBe("");
    useEditorStore.getState().redo();
    useEditorStore.getState().setGainSuggestionsEnabled(false);
    expect(renderToStaticMarkup(<GainSuggestion />)).toBe("");
  });
});
