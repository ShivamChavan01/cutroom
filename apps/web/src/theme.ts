/** Shared visual language. One palette so panels don't drift apart. */
export const theme = {
  bg: "#101010",
  panel: "#1c1c1c",
  lane: "#171717",
  border: "#363636",
  text: "#e6e6e6",
  dim: "#b0b0b0",
  faint: "#969696",
  accent: "#638bff",
  onAccent: "#101010",
  warn: "#efbd6a",
  error: "#f07c8a",
  ok: "#63c9a1",
  radius: 6,
  font: "system-ui, sans-serif",
  mono: "ui-monospace, monospace",
} as const;

export const panelStyle: React.CSSProperties = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: theme.radius,
};

export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}
