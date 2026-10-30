import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { clearProject, readProject, storageUsage, writeProject } from "./storage";

describe("IndexedDB storage layer", () => {
  afterEach(async () => {
    await clearProject();
  });

  it("round-trips a project through the database", async () => {
    const written = await writeProject('{"version":1,"hello":"world"}');
    expect(written.ok).toBe(true);
    expect(written.status).toBe("ok");

    const read = await readProject();
    expect(read.ok).toBe(true);
    expect(read.value).toBe('{"version":1,"hello":"world"}');
  });

  it("reports an empty slot rather than failing", async () => {
    const read = await readProject();
    expect(read.ok).toBe(true);
    expect(read.value).toBeUndefined();
  });

  it("overwrites a previous project", async () => {
    await writeProject("first");
    await writeProject("second");
    const read = await readProject();
    expect(read.value).toBe("second");
  });

  it("clears the stored project", async () => {
    await writeProject("something");
    const cleared = await clearProject();
    expect(cleared.ok).toBe(true);
    const read = await readProject();
    expect(read.value).toBeUndefined();
  });

  it("reports storage usage without throwing when the API is absent", async () => {
    const usage = await storageUsage();
    expect(usage).toHaveProperty("usage");
    expect(usage).toHaveProperty("quota");
  });
});

it("preserves the personal project when a demo is created, edited, and reset", async () => {
  await writeProject("personal", "current");
  await writeProject("demo", "current.demo-v1");
  expect((await readProject("current")).value).toBe("personal");
  expect((await readProject("current.demo-v1")).value).toBe("demo");
  await writeProject("demo edited", "current.demo-v1");
  await clearProject("current.demo-v1");
  expect((await readProject("current.demo-v1")).value).toBeUndefined();
  expect((await readProject("current")).value).toBe("personal");
  await clearProject("current");
});
