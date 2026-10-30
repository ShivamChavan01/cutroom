import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App";
import { usePersistenceStore } from "./lib/persistence/persistenceStore";

vi.mock("./lib/persistence/usePersistence", () => ({useProjectPersistence: () => {}, resetProject: vi.fn(), exportRawProject: vi.fn()}));
vi.mock("./lib/persistence/persistenceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/persistence/persistenceStore")>();
  return {...actual, usePersistenceStore: Object.assign(<T,>(select: (state: ReturnType<typeof actual.usePersistenceStore.getState>) => T) => select(actual.usePersistenceStore.getState()), {getState: actual.usePersistenceStore.getState})};
});
afterEach(() => usePersistenceStore.getState().setHydrated(false));
it("withholds editing and import controls until the stored workspace has been read", () => {
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('role="status"');
  expect(html).toContain("Restoring workspace");
  expect(html).not.toContain('type="file"');
  expect(html).not.toContain("Try demo project");
});
it("makes the normal editor available after restoration, including an explicit mobile limitation", () => {
  usePersistenceStore.getState().setHydrated(true);
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('type="file"');
  expect(html).toContain("Try demo project");
  expect(html).toContain("at least 1024px");
  expect(html).toContain("Export timeline");
});
