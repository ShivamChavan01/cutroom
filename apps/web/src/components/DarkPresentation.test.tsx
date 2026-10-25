import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { BottomPanel } from "./BottomPanel";

vi.mock("../store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store")>();
  return {
    ...actual,
    useEditorStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useEditorStore.getState>) => T) => selector(actual.useEditorStore.getState()),
      { getState: actual.useEditorStore.getState },
    ),
  };
});

it("preserves disabled action semantics and the accessible label", () => {
  const html = renderToStaticMarkup(<Button variant="default" disabled aria-label="Save version">Save</Button>);
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-label="Save version"');
  expect(html).toContain(">Save</button>");
});

it("preserves numeric input limits, name and value", () => {
  const html = renderToStaticMarkup(<Input type="number" min={0} max={100} defaultValue={30} aria-label="Volume" />);
  for (const attribute of ['type="number"', 'min="0"', 'max="100"', 'value="30"', 'aria-label="Volume"']) expect(html).toContain(attribute);
});

it("still explains a clean sequence in the verification panel", () => {
  useEditorStore.getState().loadTimeline(emptyTimeline("dark-presentation"));
  const html = renderToStaticMarkup(<DiagnosticsPanel />);
  expect(html).toContain('aria-label="diagnostics"');
  expect(html).toContain("Clean — no issues found.");
  expect(html).toContain("Linter — 0 issues");
});

it("exposes review tabs and the current verification panel", () => {
  useEditorStore.getState().loadTimeline(emptyTimeline("review-tabs"));
  const html = renderToStaticMarkup(<BottomPanel />);
  expect(html).toContain('aria-label="Review views"');
  expect(html).toContain('role="tabpanel"');
  expect(html).toContain(">Issues</button>");
  expect(html).toContain(">Activity</button>");
  expect(html).toContain("Clean — no issues found.");
});
