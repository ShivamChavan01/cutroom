import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductionContextPanel } from "./ProductionContextPanel";

it("offers production inputs and explicit authored-evidence import without claiming analysis", () => {
  const html = renderToStaticMarkup(<ProductionContextPanel />);
  for (const label of ["Production brief", "Reference style direction", "Continuity requirement", "Maximum production duration seconds", "Import production context"]) expect(html).toContain(`aria-label="${label}"`);
  expect(html).toContain("Save production brief");
  expect(html.indexOf('class="production-editor-heading"')).toBeLessThan(html.indexOf('class="production-editor-scroll"'));
  expect(html).toContain("No automatic footage analysis");
  expect(html).not.toContain("verified style");
});
