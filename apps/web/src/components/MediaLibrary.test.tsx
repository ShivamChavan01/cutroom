import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline, putAsset } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";
import { SidePanel } from "./SidePanel";
import { UploadButton } from "./UploadButton";

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

vi.mock("../uiStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../uiStore")>();
  return {
    ...actual,
    useUiStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useUiStore.getState>) => T) => selector(actual.useUiStore.getState()),
      { setState: actual.useUiStore.setState },
    ),
  };
});

describe("media library controls", () => {
  beforeEach(() => {
    useUiStore.setState({ rail: "media" });
    useEditorStore.getState().loadTimeline(emptyTimeline("library-test"));
  });

  it("labels all library sections, search and layout controls", () => {
    const html = renderToStaticMarkup(<SidePanel />);
    for (const text of ["Footage", "Sequences", "Graphics", 'aria-label="Search media"', 'aria-label="Grid view"', 'aria-label="List view"']) expect(html).toContain(text);
    expect(html).toContain('aria-label="Media tags"');
  });

  it("renders source filenames and available metadata without inventing tags", () => {
    useEditorStore.getState().loadTimeline(putAsset(emptyTimeline("library-test"), {
      id: "cabin-asset", kind: "video", duration: 2_000, width: 1920, height: 1080, bytes: 2048, name: "Cabin.mp4", tags: ["B-roll"],
    }));
    const html = renderToStaticMarkup(<SidePanel />);
    expect(html).toContain("Cabin.mp4");
    expect(html).toContain("1920 × 1080");
    expect(html).toContain("B-roll");
    expect(html).toContain('aria-label="Tag Cabin.mp4"');
    expect(html).not.toContain("Interviews");
  });

  it("keeps picker MIME filters configurable for the Graphics view", () => {
    const html = renderToStaticMarkup(<UploadButton label="Import graphics" accept="image/*" />);
    expect(html).toContain('accept="image/*"');
    expect(html).toContain("Import graphics");
    expect(renderToStaticMarkup(<UploadButton />)).toContain('accept="video/*,audio/*,image/*"');
  });
});
