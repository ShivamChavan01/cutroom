import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline, putAsset } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";
import { Preview } from "./Preview";
import { SidePanel } from "./SidePanel";

vi.mock("../store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store")>();
  return {
    ...actual,
    useEditorStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useEditorStore.getState>) => T) =>
        selector(actual.useEditorStore.getState()),
      { getState: actual.useEditorStore.getState },
    ),
  };
});

vi.mock("../uiStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../uiStore")>();
  return {
    ...actual,
    useUiStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useUiStore.getState>) => T) =>
        selector(actual.useUiStore.getState()),
      { setState: actual.useUiStore.setState, getState: actual.useUiStore.getState },
    ),
  };
});

vi.mock("./Player", () => ({ Player: () => <div>Video canvas</div> }));

describe("editor presentation", () => {
  beforeEach(() => {
    useEditorStore.getState().loadTimeline(emptyTimeline("presentation-test"));
    useUiStore.setState({ rail: "media" });
  });

  it("opens the verification assistant from its workspace rail item", () => {
    useUiStore.setState({ rail: "assistant" });
    const html = renderToStaticMarkup(<SidePanel />);
    expect(html).toContain('aria-label="AI verification assistant"');
    expect(html).not.toContain("Project media");
  });

  it("offers an import action in an empty media library", () => {
    const html = renderToStaticMarkup(<SidePanel />);
    expect(html).toContain("Project media");
    expect(html).toContain("Import your footage");
    expect(html).toMatch(/<button[^>]*>.*?Import video<\/button>/);
    expect(html).toContain('type="file"');
  });

  it("shows media identity, duration and size after import", () => {
    useEditorStore.getState().loadTimeline(putAsset(emptyTimeline("media"), {
      id: "source-video-1234", kind: "video", duration: 2_000, bytes: 2_048,
    }));
    const html = renderToStaticMarkup(<SidePanel />);
    expect(html).toContain("Video 01");
    expect(html).toContain("source-video-1234");
    expect(html).toContain("0:02.00");
    expect(html).toContain("2 KB");
    expect(html).not.toContain("Import your footage");
  });

  it("identifies versions and retains history and graph navigation", () => {
    useUiStore.setState({ rail: "versions" });
    const html = renderToStaticMarkup(<SidePanel />);
    expect(html).toContain("Versions");
    expect(html).toContain("History");
    expect(html).toContain("Graph");
    expect(html).not.toContain("Project media");
  });

  it("names the preview and retains playback controls", () => {
    const html = renderToStaticMarkup(<Preview />);
    expect(html).toContain('aria-label="Video preview"');
    expect(html).toContain("Fit to panel");
    expect(html).toContain("Video canvas");
    expect(html).toContain('aria-label="play"');
    expect(html).toContain('aria-label="timecode"');
  });
});
