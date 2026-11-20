import { afterEach, expect, it, vi } from "vitest";
import {clearAssetUrls, registerAssetUrl, resolveAssetUrl} from "../assets";
import {prepareEditingCopy, previewEditingCopy, restoreOriginalMedia, useEditingCopies, useEditingJob} from "./editingCopy";
import {encodeEditingCopy} from "./encodeEditingCopy";

vi.mock("./encodeEditingCopy", () => ({encodeEditingCopy: vi.fn()}));
const file = new File(["frames"], "cut.edit.mp4");
afterEach(() => { clearAssetUrls(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("previews the saved file independently and releases it when returning to the original", async () => {
  registerAssetUrl("a", "blob:original");
  vi.mocked(encodeEditingCopy).mockResolvedValueOnce(file);
  await prepareEditingCopy("a", "blob:original", vi.fn().mockResolvedValue({}));
  const copy = useEditingCopies.getState().get("a");
  expect(copy?.url).toMatch(/^blob:/);
  expect(resolveAssetUrl("a")).toBe("blob:original");
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  restoreOriginalMedia("a");
  expect(revoke).toHaveBeenCalledWith(copy?.url);
  expect(useEditingCopies.getState().size).toBe(0);
});

it("ignores stale copies, cancels on source replacement and serializes preparations", async () => {
  registerAssetUrl("a", "blob:first");
  previewEditingCopy("a", "blob:first", file);
  let finish!: (handle: FileSystemFileHandle) => void;
  const pending = prepareEditingCopy("a", "blob:first", () => new Promise(resolve => { finish = resolve; }));
  const second = vi.fn();
  await prepareEditingCopy("a", "blob:first", second);
  expect(second).not.toHaveBeenCalled();
  registerAssetUrl("a", "blob:second");
  finish({} as FileSystemFileHandle);
  await pending;
  previewEditingCopy("a", "blob:first", file);
  expect(useEditingCopies.getState().size).toBe(0);
  expect(encodeEditingCopy).not.toHaveBeenCalled();
  expect(useEditingJob.getState()).toEqual({job: null, error: null});
});

it("keeps picker cancellation quiet and exposes preparation failures", async () => {
  const pick = vi.fn().mockRejectedValueOnce(new DOMException("Dismissed", "AbortError")).mockRejectedValueOnce(new Error("Disk full"));
  await prepareEditingCopy("a", "blob:a", pick);
  expect(useEditingJob.getState().error).toBeNull();
  await prepareEditingCopy("a", "blob:a", pick);
  expect(useEditingJob.getState().error).toEqual({id: "a", message: "Disk full"});
});
