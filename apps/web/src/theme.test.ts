import { expect, it } from "vitest";
import { theme } from "./theme";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return ((values[1] ?? 0) + 0.05) / ((values[0] ?? 0) + 0.05);
}

it("keeps normal and diagnostic text readable on dark editor surfaces", () => {
  for (const surface of [theme.bg, theme.panel, theme.lane]) {
    expect(luminance(surface)).toBeLessThan(0.03);
    for (const text of [theme.text, theme.dim, theme.faint, theme.warn, theme.error, theme.ok]) {
      expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("keeps primary action labels readable on the blue accent", () => {
  expect(contrast(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(4.5);
});

it("keeps editor surfaces and ordinary text neutral without a blue tint", () => {
  for (const color of [theme.bg, theme.panel, theme.lane, theme.border, theme.text, theme.dim, theme.faint]) {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
    expect(Math.max(...channels) - Math.min(...channels), color).toBe(0);
  }
});
