import type { TimeScale } from "../lib/timeScale";
import { theme } from "../theme";

/** Time ruler above the lanes. Tick step adapts to zoom (~80px per tick). */
export function TimeRuler({ scale, width }: { scale: TimeScale; width: number }) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((s) => s * scale.pxPerSecond >= 80) ?? 600;
  const durationMs = (width / scale.pxPerSecond) * 1000;
  const ticks: number[] = [];
  for (let ms = 0; ms <= durationMs + step * 1000; ms += step * 1000) {
    ticks.push(ms);
  }
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        height: 22,
        width,
        borderBottom: `1px solid ${theme.border}`,
        background: theme.panel,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {ticks.map((ms) => (
        <div
          key={ms}
          style={{
            position: "absolute",
            left: scale.timeToPx(ms),
            top: 0,
            bottom: 0,
            borderLeft: "1px solid #343a40",
            paddingLeft: 4,
            fontSize: 10,
            color: theme.dim,
            lineHeight: "22px",
            userSelect: "none",
          }}
        >
          {Math.floor(ms / 60000)}:{String(Math.floor((ms / 1000) % 60)).padStart(2, "0")}
        </div>
      ))}
    </div>
  );
}
