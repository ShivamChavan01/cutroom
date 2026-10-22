import { describe, expect, it } from "vitest";
import { formatBytes, freeBytes, isOpfsAvailable, mediaUsage } from "./opfs";

/**
 * Only the browser-independent parts are covered here. The OPFS calls
 * themselves (getDirectory, createWritable, readMediaUrl) need a real
 * browser: jsdom does not implement OPFS and fake-indexeddb only covers
 * IndexedDB. Those paths are exercised manually — the upload path writes a
 * file and the app re-reads it after a refresh.
 */
describe("opfs helpers", () => {
  it("reports OPFS as unavailable outside a browser", () => {
    expect(isOpfsAvailable()).toBe(false);
  });

  it("reports free space as unknown rather than guessing", async () => {
    expect(await freeBytes()).toBeNull();
  });

  it("reports zero usage rather than throwing when unavailable", async () => {
    expect(await mediaUsage()).toEqual({ files: 0, bytes: 0 });
  });

  it("formats byte counts", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1048576)).toBe("5.0 MB");
    expect(formatBytes(3 * 1073741824)).toBe("3.00 GB");
  });
});
