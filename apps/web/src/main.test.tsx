import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "@vercel/analytics/react";
import { App } from "./App";

const { render, createRoot } = vi.hoisted(() => ({ render: vi.fn(), createRoot: vi.fn() }));
vi.mock("react-dom/client", () => ({ createRoot }));
vi.mock("./App", () => ({ App: () => null }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  createRoot.mockReturnValue({ render });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("editor entry point", () => {
  it.each(["true", "false", undefined])("mounts the editor and enables analytics only for Vercel builds (%s)", async (enabled) => {
    const root = {};
    vi.stubGlobal("document", { getElementById: vi.fn().mockReturnValue(root) });
    vi.stubEnv("VITE_VERCEL_ANALYTICS", enabled);
    await import("./main");
    expect(createRoot).toHaveBeenCalledExactlyOnceWith(root);
    expect(render).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: StrictMode,
      props: { children: [expect.objectContaining({ type: App }), enabled === "true" ? expect.objectContaining({ type: Analytics }) : false] },
    }));
  });
  it("reports a missing mount element before initializing the editor", async () => {
    vi.stubGlobal("document", { getElementById: () => null });
    await expect(import("./main")).rejects.toThrow("missing #root element");
    expect(createRoot).not.toHaveBeenCalled();
  });
});
