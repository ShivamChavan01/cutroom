import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline, makeClip } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { createTimeScale } from "../lib/timeScale";
import { registerMediaPoster, useMediaPosters } from "../lib/media/poster";
import { TopBar } from "./TopBar";
import { ActivityBar } from "./ActivityBar";
import { ClipBlock } from "./ClipBlock";

vi.mock("../store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store")>();
  return {
    ...actual,
    useEditorStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useEditorStore.getState>) => T) => selector(actual.useEditorStore.getState()),
      { getState: actual.useEditorStore.getState },
    ),
  };
});

vi.mock("../lib/media/poster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/media/poster")>();
  return {
    ...actual,
    useMediaPosters: Object.assign(
      <T,>(selector: (posters: ReadonlyMap<string, string>) => T) => selector(actual.useMediaPosters.getState()),
      { setState: actual.useMediaPosters.setState },
    ),
  };
});

describe("studio chrome", () => {
  beforeEach(() => {
    useEditorStore.getState().loadTimeline(emptyTimeline("untitled"));
    useMediaPosters.setState(new Map(), true);
  });

  it("identifies the project and keeps import and export available", () => {
    const html = renderToStaticMarkup(<TopBar />);
    expect(html).toContain("Untitled project");
    expect(html).toContain("Add media");
    expect(html).toContain('aria-controls="assistant-sidebar"');
    expect(html.indexOf('id="open-assistant"')).toBeGreaterThan(html.indexOf("Export"));
    expect(html).toContain("Export");
    expect(html).toContain('aria-label="Project menu"');
  });

  it("uses the actual project name after loading a project", () => {
    useEditorStore.getState().loadTimeline(emptyTimeline("Documentary cut"));
    expect(renderToStaticMarkup(<TopBar />)).toContain("Documentary cut");
  });

  it("lists the project destinations with no panel selected initially", () => {
    const html = renderToStaticMarkup(<ActivityBar />);
    for (const label of ["Media", "Versions", "Issues", "Properties", "Settings"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(5);
    expect(html.match(/aria-controls="properties-sidebar"/g)).toHaveLength(5);
    expect(html).toContain(">Media</span>");
    expect(html).not.toContain('id="open-assistant"');
  });

  it("renders cached footage in timeline strips without creating a decoder", () => {
    registerMediaPoster("asset-a", "data:image/jpeg;base64,frame");
    const clip = makeClip({ id: "clip-a", trackId: "v1", assetId: "asset-a", start: 0, inPoint: 0, duration: 2_000, volume: 1 });
    const html = renderToStaticMarkup(<ClipBlock clip={clip} scale={createTimeScale(50)} assetDurationMs={2_000} diagnostics={[]} author={undefined} />);
    expect(html).toContain("clip-filmstrip");
    expect(html).toContain("data:image/jpeg;base64,frame");
    expect(html).not.toContain("<video");
    expect(html).toContain('aria-label="clip clip-a"');
  });
});

it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])("renders offline clips with absent own asset %s without crashing", assetId => {
  const clip = makeClip({id: "offline", assetId, trackId: "v1", start: 0, inPoint: 0, duration: 1000, volume: 1});
  useEditorStore.getState().loadTimeline({...emptyTimeline("Offline"), clips: {offline: clip}});
  expect(() => renderToStaticMarkup(<ClipBlock clip={clip} scale={createTimeScale(50)} assetDurationMs={undefined} diagnostics={[]} author={undefined} />)).not.toThrow();
});
