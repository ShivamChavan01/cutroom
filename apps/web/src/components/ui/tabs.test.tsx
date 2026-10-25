import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

it("connects the selected tab to its panel and keeps inactive content hidden", () => {
  const html = renderToStaticMarkup(<Tabs defaultValue="history">
    <TabsList aria-label="Version views"><TabsTrigger value="history">History</TabsTrigger><TabsTrigger value="graph">Graph</TabsTrigger></TabsList>
    <TabsContent value="history">Saved versions</TabsContent><TabsContent value="graph">Branch geometry</TabsContent>
  </Tabs>);
  expect(html).toMatch(/role="tablist"[^>]*aria-label="Version views"/);
  expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>History/);
  expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>Graph/);
  expect(html).toContain("Saved versions");
  expect(html).not.toContain("Branch geometry");
  const panelId = html.match(/aria-selected="true" aria-controls="([^"]+)"/)?.[1];
  expect(panelId).toBeDefined();
  expect(html).toContain(`id="${panelId}"`);
});

it("respects a controlled selection and disabled tabs", () => {
  const html = renderToStaticMarkup(<Tabs value="project">
    <TabsList variant="line"><TabsTrigger value="clip" disabled>Clip</TabsTrigger><TabsTrigger value="project">Project</TabsTrigger></TabsList>
    <TabsContent value="project">Project settings</TabsContent>
  </Tabs>);
  expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*disabled=""[^>]*>Clip/);
  expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Project/);
  expect(html).toContain("Project settings");
});
