import { describe, expect, it } from "vitest";
import { applyOps, clipsOnTrack, diffTimelines, lint, timelineDuration } from "@cutroom/engine";
import { buildScenarios, findScenario, lintRulesFor } from "./scenarios";

describe("scenarios", () => {
  it("builds every scenario with a valid, non-empty timeline", () => {
    const scenarios = buildScenarios();
    expect(scenarios.length).toBeGreaterThan(0);
    for (const s of scenarios) {
      expect(Object.keys(s.timeline.clips).length).toBeGreaterThan(0);
      expect(timelineDuration(s.timeline)).toBeGreaterThan(0);
      expect(s.expect.length).toBeGreaterThan(10);
    }
  });

  it("gives every scenario the assets it references", () => {
    for (const s of buildScenarios()) {
      for (const clip of Object.values(s.timeline.clips)) {
        expect(s.timeline.assets[clip.assetId]).toBeDefined();
      }
    }
  });

  it("reports the linter rules each scenario expects", () => {
    for (const s of buildScenarios()) {
      expect(lintRulesFor(s)).toEqual([...s.expectLint].sort());
    }
  });

  it("builds the boundary scenario with two different assets back to back", () => {
    const s = findScenario("boundary");
    expect(s).toBeDefined();
    if (s === undefined) return;
    const clips = clipsOnTrack(s.timeline, "v1");
    expect(clips.map((c) => c.id)).toEqual(["first", "second"]);
    expect(clips[0]!.assetId).not.toBe(clips[1]!.assetId);
    // No gap between them: the cut is a hard cut.
    expect(clips[1]!.start).toBe(clips[0]!.start + clips[0]!.duration);
  });

  it("builds the gap scenario with real dead air", () => {
    const s = findScenario("gap");
    if (s === undefined) throw new Error("missing gap scenario");
    const clips = clipsOnTrack(s.timeline, "v1");
    expect(clips[1]!.start - (clips[0]!.start + clips[0]!.duration)).toBe(3_000);
    expect(lint(s.timeline).some((d) => d.rule === "gap")).toBe(true);
  });

  it("builds the overlap scenario with a colliding pair", () => {
    const s = findScenario("overlap");
    if (s === undefined) throw new Error("missing overlap scenario");
    expect(lint(s.timeline).some((d) => d.rule === "overlap")).toBe(true);
  });

  it("produces a diff between two scenarios for the diff view", () => {
    const a = findScenario("single");
    const b = findScenario("boundary");
    if (a === undefined || b === undefined) throw new Error("missing scenarios");
    const diff = diffTimelines(a.timeline, b.timeline);
    expect(diff.added).toBeGreaterThan(0);
  });

  it("keeps scenarios deterministic", () => {
    const first = buildScenarios().map((s) => JSON.stringify(s.timeline));
    const second = buildScenarios().map((s) => JSON.stringify(s.timeline));
    expect(first).toEqual(second);
  });
});
