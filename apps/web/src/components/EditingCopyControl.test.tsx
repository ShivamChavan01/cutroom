import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, expect, it, vi} from "vitest";
import {EditingCopyControl} from "./EditingCopyControl";
import {useEditingJob} from "../lib/media/editingCopy";

vi.mock("../lib/assets", async original => {
  const actual = await original<typeof import("../lib/assets")>();
  return {...actual, useAssetUrls: Object.assign(() => "blob:original", actual.useAssetUrls)};
});
const asset = {id: "camera", name: "Camera.mp4", kind: "video" as const, duration: 12000};
afterEach(() => vi.unstubAllGlobals());

it("offers preparation only when the encoder and local save picker are available", () => {
  expect(renderToStaticMarkup(<EditingCopyControl asset={asset}/>)).toBe("");
  vi.stubGlobal("window", {showSaveFilePicker: vi.fn()});
  vi.stubGlobal("VideoEncoder", class {});
  expect(renderToStaticMarkup(<EditingCopyControl asset={asset}/>)).toContain("Prepare editing copy");
  expect(useEditingJob.getState().job).toBeNull();
});
