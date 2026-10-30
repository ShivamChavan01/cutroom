import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline, makeClip } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { Preview } from "./Preview";
import { Transport } from "./Transport";

vi.mock("./Player", () => ({ Player: () => <div>Preview media</div> }));
vi.mock("../store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store")>();
  return {
    ...actual,
    usePlayhead: () => actual.useEditorStore.getState().playheadMs,
    useEditorStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useEditorStore.getState>) => T) => selector(actual.useEditorStore.getState()),
      { getState: actual.useEditorStore.getState },
    ),
  };
});

describe("preview controls", () => {
  beforeEach(() => useEditorStore.getState().loadTimeline(emptyTimeline("preview-test")));

  it("offers explicit fit and native pixel zoom modes plus fullscreen", () => {
    const html = renderToStaticMarkup(<Preview />);
    expect(html).toContain('aria-label="Preview zoom"');
    expect(html).toContain('value="fit"');
    expect(html).toContain('value="1"');
    expect(html).toContain('value="0.5"');
    expect(html).toContain('aria-label="Enter fullscreen"');
    expect(html).toContain("Your sequence plays here.");
  });

  it("uses the project frame rate in transport timecode", () => {
    useEditorStore.getState().loadTimeline({ ...emptyTimeline(), fps: 24 });
    useEditorStore.getState().setPlayhead(1_500);
    expect(renderToStaticMarkup(<Transport />)).toContain("00:00:01:12");
  });

  it("navigates cuts on later tracks as well as the first video track", () => {
    const clip = makeClip({ id: "upper", trackId: "v2", assetId: "asset", start: 2_000, inPoint: 0, duration: 1_000, volume: 1 });
    useEditorStore.getState().loadTimeline({ ...emptyTimeline(), clips: { upper: clip } });
    const html = renderToStaticMarkup(<Transport />);
    const next = html.match(/<button[^>]*aria-label="next cut"[^>]*>/)?.[0];
    expect(next).toBeDefined();
    expect(next).not.toContain('disabled=""');
  });
});
