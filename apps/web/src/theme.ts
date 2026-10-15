/** Shared visual language. One palette so panels don't drift apart. */
export const theme = {
  bg: "#0b0c0e",
  panel: "#101114",
  lane: "#1a1b1e",
  border: "#2c2e33",
  text: "#e9ecef",
  dim: "#868e96",
  faint: "#495057",
  accent: "#d97757",
  warn: "#ffd43b",
  error: "#ff6b6b",
  ok: "#51cf66",
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
