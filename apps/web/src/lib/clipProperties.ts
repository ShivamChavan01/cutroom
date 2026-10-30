import type { Clip, Op } from "@cutroom/engine";

export type ClipProperty = "x" | "y" | "scaleX" | "scaleY" | "rotation" | "start" | "inPoint" | "outPoint" | "volume";

function milliseconds(seconds: number): number {
  const value = Math.round(seconds * 1000);
  if (!Number.isSafeInteger(value)) throw new Error("Time is outside the supported millisecond range.");
  return value;
}

export function clipPropertyOp(clip: Clip, field: ClipProperty, value: number, linkedScale = false): Op {
  if (!Number.isFinite(value)) throw new Error("Enter a finite number.");
  switch (field) {
    case "start":
      if (value < 0) throw new Error("Start cannot be negative.");
      return { type: "moveClip", clipId: clip.id, start: milliseconds(value) };
    case "inPoint": {
      const inPoint = milliseconds(value);
      if (inPoint < 0 || inPoint >= clip.outPoint) throw new Error("In-point must precede the out-point.");
      return { type: "trimClip", clipId: clip.id, inPoint, duration: clip.outPoint - inPoint };
    }
    case "outPoint": {
      const duration = milliseconds(value) - clip.inPoint;
      if (duration <= 0) throw new Error("Out-point must follow the in-point.");
      return { type: "trimClip", clipId: clip.id, duration };
    }
    case "volume":
      if (value < 0 || value > 100) throw new Error("Volume must be between 0 and 100%.");
      return { type: "setVolume", clipId: clip.id, volume: value / 100 };
    case "scaleX":
    case "scaleY": {
      if (value <= 0 || value > 2_000) throw new Error("Scale must be greater than 0 and at most 2000%.");
      const scale = value / 100;
      if (!linkedScale) return { type: "setTransform", clipId: clip.id, [field]: scale };
      const ratio = scale / (clip[field] ?? 1);
      return { type: "setTransform", clipId: clip.id, scaleX: (clip.scaleX ?? 1) * ratio, scaleY: (clip.scaleY ?? 1) * ratio };
    }
    case "x":
    case "y":
    case "rotation":
      return { type: "setTransform", clipId: clip.id, [field]: value };
  }
}
