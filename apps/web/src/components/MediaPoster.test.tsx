import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { registerMediaPoster, useMediaPosters } from "../lib/media/poster";
import { MediaPoster } from "./MediaPoster";

vi.mock("../lib/media/poster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/media/poster")>();
  return {
    ...actual,
    useMediaPosters: Object.assign(
      <T,>(selector: (posters: ReadonlyMap<string, string>) => T) =>
        selector(actual.useMediaPosters.getState()),
      { getState: actual.useMediaPosters.getState, setState: actual.useMediaPosters.setState },
    ),
  };
});

describe("media poster", () => {
  beforeEach(() => useMediaPosters.setState(new Map(), true));

  it("shows an unobtrusive fallback when no frame is available", () => {
    const html = renderToStaticMarkup(<MediaPoster assetId="missing" />);
    expect(html).toContain('class="media-poster-fallback"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<img");
  });

  it("renders the actual cached frame without repeating adjacent media labels", () => {
    registerMediaPoster("asset-a", "data:image/jpeg;base64,frame");
    const html = renderToStaticMarkup(<MediaPoster assetId="asset-a" />);
    expect(html).toContain('src="data:image/jpeg;base64,frame"');
    expect(html).toContain('alt=""');
    expect(html).not.toContain("media-poster-fallback");
  });

  it("never shows a different asset's frame", () => {
    registerMediaPoster("asset-a", "data:image/jpeg;base64,frame");
    const html = renderToStaticMarkup(<MediaPoster assetId="asset-b" />);
    expect(html).not.toContain("<img");
  });
});
