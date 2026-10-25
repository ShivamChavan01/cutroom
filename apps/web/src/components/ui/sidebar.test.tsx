import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "./sidebar";
import { ExportMenu } from "../ExportMenu";

it("renders a semantic menu with an accessible current destination", () => {
  const html = renderToStaticMarkup(<SidebarMenu aria-label="Workspace"><SidebarMenuItem><SidebarMenuButton isActive>Media</SidebarMenuButton></SidebarMenuItem></SidebarMenu>);
  expect(html).toMatch(/<ul[^>]*aria-label="Workspace"/);
  expect(html).toContain("<li");
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('type="button"');
  expect(html).toContain(">Media<svg");
  expect(html).toContain("data-current-marker");
});

it("preserves disabled controls without marking them as the current page", () => {
  const html = renderToStaticMarkup(<SidebarMenuButton disabled aria-label="Versions">Versions</SidebarMenuButton>);
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-label="Versions"');
  expect(html).not.toContain("aria-current");
  expect(html).not.toContain("data-current-marker");
});

it("shows a visible marker only for the selected destination", () => {
  const html = renderToStaticMarkup(<SidebarMenu>
    <SidebarMenuItem><SidebarMenuButton>Media</SidebarMenuButton></SidebarMenuItem>
    <SidebarMenuItem><SidebarMenuButton isActive>Versions</SidebarMenuButton></SidebarMenuItem>
  </SidebarMenu>);
  expect(html.match(/data-current-marker/g)).toHaveLength(1);
  expect(html).toMatch(/Versions<svg[^>]*data-current-marker/);
});

it("offers the same accessible export menu from the sidebar and header", () => {
  for (const sidebar of [true, false]) {
    const html = renderToStaticMarkup(<ExportMenu sidebar={sidebar} />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('title="Export the timeline"');
    expect(html).toContain("Export");
  }
});
