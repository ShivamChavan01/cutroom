import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../vite.config";

afterEach(() => vi.unstubAllEnvs());

describe("Vercel analytics build configuration", () => {
  it.each([["1", "true"], ["0", "false"], [undefined, "false"]])("enables analytics only when Vercel identifies the build (%s)", (vercel, expected) => {
    vi.stubEnv("VERCEL", vercel);
    const resolved = config({ command: "build", mode: "production" });
    expect(resolved.define?.["import.meta.env.VITE_VERCEL_ANALYTICS"]).toBe(JSON.stringify(expected));
  });
});
