import { applyOp, diffTimelines, lint, lintDelta, type Op, type Timeline } from "@cutroom/engine";

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an object in the AI response.");
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2000) throw new Error("Invalid text in the AI response.");
  return value;
}

function number(value: unknown, min = 0, max = 86_400_000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Invalid number in the AI response.");
  return value;
}

function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unexpected field in the AI response.");
}

function parseOp(input: unknown): Op {
  const value = object(input);
  const clipId = text(value.clipId);
  switch (value.type) {
    case "deleteClip":
      fields(value, ["type", "clipId"]);
      return { type: value.type, clipId };
    case "splitClip":
      fields(value, ["type", "clipId", "at"]);
      return { type: value.type, clipId, at: number(value.at, 1) };
    case "moveClip":
      fields(value, ["type", "clipId", "start", "trackId"]);
      return { type: value.type, clipId, start: number(value.start), ...(value.trackId === undefined ? {} : { trackId: text(value.trackId) }) };
    case "trimClip": {
      fields(value, ["type", "clipId", "inPoint", "duration"]);
      if (value.inPoint === undefined && value.duration === undefined) throw new Error("A trim needs an in point or duration.");
      return { type: value.type, clipId, ...(value.inPoint === undefined ? {} : { inPoint: number(value.inPoint) }), ...(value.duration === undefined ? {} : { duration: number(value.duration, 1) }) };
    }
    case "setVolume":
      fields(value, ["type", "clipId", "volume"]);
      return { type: value.type, clipId, volume: number(value.volume, 0, 1) };
    case "setTransform": {
      fields(value, ["type", "clipId", "x", "y", "scaleX", "scaleY", "rotation"]);
      if ([value.x, value.y, value.scaleX, value.scaleY, value.rotation].every((field) => field === undefined)) throw new Error("A transform needs a changed field.");
      return {
        type: value.type, clipId,
        ...(value.x === undefined ? {} : { x: number(value.x, -100_000, 100_000) }),
        ...(value.y === undefined ? {} : { y: number(value.y, -100_000, 100_000) }),
        ...(value.scaleX === undefined ? {} : { scaleX: number(value.scaleX, 0.01, 20) }),
        ...(value.scaleY === undefined ? {} : { scaleY: number(value.scaleY, 0.01, 20) }),
        ...(value.rotation === undefined ? {} : { rotation: number(value.rotation, -3600, 3600) }),
      };
    }
    default: throw new Error("The AI proposed an unsupported operation.");
  }
}

export function parsePlan(input: unknown) {
  const value = object(input);
  fields(value, ["summary", "ops"]);
  if (!Array.isArray(value.ops) || value.ops.length > 50) throw new Error("The AI may propose up to 50 edits at a time.");
  return { summary: text(value.summary), ops: value.ops.map(parseOp) };
}

export function assertUnlocked(timeline: Timeline, op: Op, lockedTrackIds: readonly string[]) {
  const id = "clipId" in op ? op.clipId : op.type === "addClip" ? op.clip.id : undefined;
  const source = id === undefined ? undefined : timeline.clips[id]?.trackId;
  const destination = op.type === "addClip" ? op.clip.trackId : (op.type === "moveClip" || op.type === "detachAudio") ? op.trackId : undefined;
  if ((source !== undefined && lockedTrackIds.includes(source)) || (destination !== undefined && lockedTrackIds.includes(destination))) {
    throw new Error("This track is locked. Unlock it before editing.");
  }
}

export function previewPlan(before: Timeline, plan: ReturnType<typeof parsePlan>, lockedTrackIds: readonly string[]) {
  let after = before;
  for (const op of plan.ops) {
    if ("clipId" in op && !Object.hasOwn(after.clips, op.clipId)) throw new Error("The AI referenced a clip that does not exist.");
    assertUnlocked(after, op, lockedTrackIds);
    after = applyOp(after, op);
  }
  return { ...plan, before, after, diff: diffTimelines(before, after), verification: lintDelta(before, after) };
}

export function assistantContext(timeline: Timeline, selectedClipId: string | null, playheadMs: number, lockedTrackIds: readonly string[]) {
  if (Object.keys(timeline.clips).length > 1000) throw new Error("The assistant currently supports timelines with up to 1,000 clips.");
  const context = JSON.stringify({
    fps: timeline.fps ?? 30, tracks: timeline.tracks, clips: Object.values(timeline.clips),
    assets: Object.values(timeline.assets).map(({ id, name, kind, duration }) => ({ id, name, kind, duration })),
    selectedClipId, playheadMs, lockedTrackIds,
    issues: lint(timeline).map(({ rule, message, clipIds }) => ({ rule, message, clipIds })),
  });
  if (context.length > 250_000) throw new Error("This timeline is too large for the assistant. Use a smaller sequence.");
  return context;
}
