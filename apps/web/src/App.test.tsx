import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App";
import { usePersistenceStore } from "./lib/persistence/persistenceStore";
import { useUiStore } from "./uiStore";
vi.mock("./uiStore", async original => {
  const actual = await original<typeof import("./uiStore")>();
  return { ...actual, useUiStore: Object.assign(<T,>(select: (state: ReturnType<typeof actual.useUiStore.getState>) => T) => select(actual.useUiStore.getState()), { getState: actual.useUiStore.getState }) };
});

vi.mock("./lib/persistence/usePersistence", () => ({useProjectPersistence: () => {}, resetProject: vi.fn(), exportRawProject: vi.fn()}));
vi.mock("./lib/persistence/persistenceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/persistence/persistenceStore")>();
  return {...actual, usePersistenceStore: Object.assign(<T,>(select: (state: ReturnType<typeof actual.usePersistenceStore.getState>) => T) => select(actual.usePersistenceStore.getState()), {getState: actual.usePersistenceStore.getState})};
});
afterEach(() => { usePersistenceStore.getState().setHydrated(false); useUiStore.getState().setPropertiesTab(null); });
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
  expect(html).toMatch(/id="properties-sidebar"[^>]*hidden/);
  const rail = html.indexOf('aria-label="Project tools"');
  const sidebar = html.indexOf('id="properties-sidebar"');
  expect(rail).toBeGreaterThan(html.indexOf("</header>"));
  expect(sidebar).toBeGreaterThan(rail);
  expect(html.indexOf('aria-label="Video preview"')).toBeGreaterThan(sidebar);
  expect(html).toMatch(/id="open-inspector" aria-expanded="false"/);
});

it("opens the chat dock to the right of the timeline with the left panel closed", () => {
  usePersistenceStore.getState().setHydrated(true);
  useUiStore.getState().setPropertiesTab("assistant");
  const html = renderToStaticMarkup(<App />);
  expect(html.match(/aria-label="Video preview"/g)).toHaveLength(1);
  expect(html.match(/aria-label="AI verification assistant"/g)).toHaveLength(1);
  expect(html.match(/aria-label="Sequence workspace"/g)).toHaveLength(1);
  expect(html).toMatch(/id="open-assistant" aria-expanded="true"/);
  expect(html).toContain('aria-label="Close Assistant"');
  expect(html.indexOf('id="assistant-sidebar"')).toBeGreaterThan(html.indexOf('aria-label="Sequence workspace"'));
  expect(html).toMatch(/id="properties-sidebar"[^>]*hidden/);
  expect(html).not.toMatch(/id="assistant-sidebar"[^>]*hidden/);
  expect(html).not.toContain("Project media");
  expect(html).not.toContain('aria-label="Timeline versions"');
  expect(html).not.toContain("Agent project tools");
});
