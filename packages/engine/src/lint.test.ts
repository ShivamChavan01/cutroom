import { describe, expect, it } from "vitest";
import {
  type Timeline,
  applyOps,
  defineRule,
  diagnosticKey,
  emptyTimeline,
  errorsOnly,
  lint,
  makeClip,
  putAsset,
} from "./index";
import { baseTimeline, clipOn } from "./fixtures.js";

/** Timeline with one clean clip and nothing else to trip on. */
function cleanTimeline(): Timeline {
  return baseTimeline();
}

function byRule(
  timeline: Timeline,
  rule: string,
  options?: Parameters<typeof lint>[1],
) {
  return lint(timeline, options).filter((d) => d.rule === rule);
}

describe("lint", () => {
  it("stays silent on a clean timeline", () => {
    expect(lint(cleanTimeline())).toEqual([]);
  });

  it("flags two clips overlapping on one track", () => {
    const t = clipOn(baseTimeline(), "c2", { start: 5_000 });

    const found = byRule(t, "overlap");

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect([...(found[0]?.clipIds ?? [])].sort()).toEqual(["c1", "c2"]);
    expect(found[0]?.where).toBe(5_000);
  });

  it("does not flag adjacent clips as overlapping", () => {
    // c1 ends at 10s; c2 starts exactly at 10s. Half-open intervals touch.
    const t = clipOn(baseTimeline(), "c2", { start: 10_000 });
    expect(byRule(t, "overlap")).toEqual([]);
  });

  it("flags an overlap away from the origin, where asset-local outPoints mislead", () => {
    // Regression: the overlap sweep once gated on clip.inPoint +
    // clip.duration (the asset-local clock), so a clash at 10s-12s was
    // invisible whenever the source media started at 0.
    const t = applyOps(
      putAsset(emptyTimeline("lint-offorigin"), {
        id: "asset-a",
        kind: "video",
        duration: 60_000,
      }),
      [
        {
          type: "addClip",
          clip: makeClip({
            id: "c1", trackId: "v1", assetId: "asset-a",
            start: 10_000, inPoint: 0, duration: 2_000, volume: 1,
          }),
        },
        {
          type: "addClip",
          clip: makeClip({
            id: "c2", trackId: "v1", assetId: "asset-a",
            start: 10_500, inPoint: 0, duration: 2_000, volume: 1,
          }),
        },
      ],
    );

    const found = byRule(t, "overlap");

    expect(found).toHaveLength(1);
    expect([...(found[0]?.clipIds ?? [])].sort()).toEqual(["c1", "c2"]);
    expect(found[0]?.where).toBe(10_500);
  });

  it("flags dead air between consecutive clips", () => {
    const t = clipOn(baseTimeline(), "c2", { start: 12_000 });

    const found = byRule(t, "gap");

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.where).toBe(10_000);
  });

  it("does not report a gap for an overlapping pair", () => {
    // Overlap owns that pair; two diagnostics for one problem is noise.
    const t = clipOn(baseTimeline(), "c2", { start: 5_000 });
    expect(byRule(t, "gap")).toEqual([]);
  });

  it("flags a clip whose asset has no record", () => {
    const t = applyOps(emptyTimeline(), [
      {
        type: "addClip",
        clip: makeClip({
          id: "orphan",
          trackId: "v1",
          assetId: "ghost-file",
          start: 0,
          inPoint: 0,
          duration: 1_000,
          volume: 1,
        }),
      },
    ]);

    const found = byRule(t, "missing-media");

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.clipIds).toEqual(["orphan"]);
  });

  it("flags a sub-100ms clip as a likely bad cut", () => {
    const t = clipOn(baseTimeline(), "flash", { start: 10_000 });
    // clipOn makes 1000ms clips; shrink it to 2 frames via trim.
    const shrunk = applyOps(t, [
      { type: "trimClip", clipId: "flash", duration: 60 },
    ]);

    const found = byRule(shrunk, "flash-frame");

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
  });

  it("flags a clip reading past the end of its file", () => {
    let t = baseTimeline();
    t = putAsset(t, { id: "short", kind: "video", duration: 500 });
    t = applyOps(t, [
      {
        type: "addClip",
        clip: makeClip({
          id: "over",
          trackId: "v1",
          assetId: "short",
          start: 10_000,
          inPoint: 0,
          duration: 1_000,
          volume: 1,
        }),
      },
    ]);
    // Note: trimClip refuses to create this state, but addClip only checks
    // well-formedness — the linter is the backstop for states that arrive
    // by any path the reducer doesn't guard (hand edits, imports, merges).
    const found = byRule(t, "trim-past-source");

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
  });

  it("flags a zero-length clip even though the reducer never makes one", () => {
    const bad = {
      ...baseTimeline(),
      clips: {
        ...baseTimeline().clips,
        dead: {
          id: "dead",
          trackId: "v1",
          assetId: "asset-a",
          start: 10_000,
          inPoint: 0,
          duration: 0,
          volume: 1,
          outPoint: 0,
        },
      },
    };

    const found = byRule(bad, "zero-length");

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
  });

  it("flags an asset no clip references", () => {
    let t = baseTimeline();
    t = putAsset(t, { id: "unused", kind: "video", duration: 5_000 });

    const found = byRule(t, "unused-asset");

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
  });

  it("sorts diagnostics by position so the UI list is stable", () => {
    let t = baseTimeline();
    t = putAsset(t, { id: "unused", kind: "video", duration: 5_000 });
    t = clipOn(t, "late-overlap", { start: 9_000 });
    t = clipOn(t, "early-gap-filler", { start: 20_000 });

    const positions = lint(t)
      .map((d) => d.where ?? Number.MAX_SAFE_INTEGER);
    const sorted = [...positions].sort((a, b) => a - b);

    expect(positions).toEqual(sorted);
  });

  it("supports excluding a waived rule", () => {
    let t = clipOn(baseTimeline(), "c2", { start: 12_000 });
    t = putAsset(t, { id: "unused", kind: "video", duration: 5_000 });

    expect(byRule(t, "gap")).toHaveLength(1);
    expect(byRule(t, "gap", { exclude: ["gap"] })).toEqual([]);
    // Excluding one rule leaves the rest running (unused-asset still fires).
    expect(lint(t, { exclude: ["gap"] }).length).toBeGreaterThan(0);
  });

  it("supports running a single rule in isolation", () => {
    const t = clipOn(baseTimeline(), "c2", { start: 5_000 });

    const found = lint(t, { include: ["overlap"] });

    expect(found.length).toBeGreaterThan(0);
    expect(found.every((d) => d.rule === "overlap")).toBe(true);
  });

  it("lets the caller downgrade an error to a warning", () => {
    // Proxy-first editing: not-local-yet is normal, so missing-media warns
    // instead of blocking.
    const t = applyOps(emptyTimeline(), [
      {
        type: "addClip",
        clip: makeClip({
          id: "orphan",
          trackId: "v1",
          assetId: "ghost-file",
          start: 0,
          inPoint: 0,
          duration: 1_000,
          volume: 1,
        }),
      },
    ]);

    const found = byRule(t, "missing-media", {
      severity: { "missing-media": "warning" },
    });

    expect(found[0]?.severity).toBe("warning");
  });

  it("accepts a custom rule through the same harness", () => {
    // Rule 8 costs ten lines: the harness is the feature.
    const noSilentClips = defineRule(
      "no-silent-clips",
      "A muted clip still occupies the track; flag it for review.",
      (timeline) =>
        Object.values(timeline.clips)
          .filter((clip) => clip.volume === 0)
          .map((clip) => ({
            rule: "no-silent-clips",
            key: diagnosticKey("no-silent-clips", [clip.id]),
            severity: "warning" as const,
            clipIds: [clip.id],
            where: clip.start,
            message: `${clip.id} is silent`,
          })),
    );

    const t = applyOps(baseTimeline(), [
      { type: "setVolume", clipId: "c1", volume: 0 },
    ]);

    expect(noSilentClips.check(t)).toHaveLength(1);
    expect(noSilentClips.check(baseTimeline())).toEqual([]);
  });

  it("errorsOnly separates blocking problems from style warnings", () => {
    const t = clipOn(baseTimeline(), "c2", { start: 12_000 });

    const all = lint(t);
    const blocking = errorsOnly(all);

    expect(all.length).toBeGreaterThan(blocking.length);
    expect(blocking.every((d) => d.severity === "error")).toBe(true);
  });
});
