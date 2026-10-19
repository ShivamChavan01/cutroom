import {
  type Asset,
  type Timeline,
  applyOps,
  emptyTimeline,
  lint,
  makeClip,
  putAsset,
} from "@cutroom/engine";

/**
 * Named test scenarios.
 *
 * Each builder returns a timeline plus the asset ids it needs, so a
 * scenario can be loaded by the dev harness (apps/web/scenarios.html) and
 * asserted on in tests. Builders are pure and deterministic — the same
 * scenario always produces the same timeline, which is what makes the
 * automated assertions meaningful.
 */

export interface Scenario {
  readonly id: string;
  readonly label: string;
  /** What a human should look for when running this one by hand. */
  readonly expect: string;
  readonly timeline: Timeline;
  /** Asset ids that must be registered with a playable URL. */
  readonly assetIds: readonly string[];
  /** Rule ids the linter should report, if any. */
  readonly expectLint: readonly string[];
}

const ASSET_A = { id: "asset-a", kind: "video" as const, duration: 60_000 };
const ASSET_B = { id: "asset-b", kind: "video" as const, duration: 60_000 };

function base(): Timeline {
  let t = emptyTimeline("scenario");
  t = putAsset(t, ASSET_A);
  t = putAsset(t, ASSET_B);
  return t;
}

/** Drop assets no clip references, so the linter's unused-asset rule stays quiet. */
function usedAssets(timeline: Timeline, assetIds: readonly string[]): Timeline {
  const referenced = new Set(Object.values(timeline.clips).map((c) => c.assetId));
  const assets = { ...timeline.assets };
  for (const id of Object.keys(assets)) {
    if (!referenced.has(id)) delete assets[id];
  }
  return { ...timeline, assets };
}

function clip(
  id: string,
  assetId: string,
  start: number,
  duration: number,
  trackId = "v1",
  inPoint = 0,
) {
  return {
    type: "addClip" as const,
    clip: makeClip({
      id,
      trackId,
      assetId,
      start,
      inPoint,
      duration,
      volume: 1,
    }),
  };
}

function scenario(
  id: string,
  label: string,
  expect: string,
  timeline: Timeline,
  assetIds: readonly string[],
  expectLint: readonly string[] = [],
): Scenario {
  // Only assets the clips actually use are kept: an unused asset is a real
  // linter finding, and a scenario that trips it by construction is noise.
  const referenced = new Set(Object.values(timeline.clips).map((c) => c.assetId));
  const kept = assetIds.filter((assetId) => referenced.has(assetId));
  const assets = { ...timeline.assets };
  for (const assetId of Object.keys(assets)) {
    if (!referenced.has(assetId)) delete assets[assetId];
  }
  return {
    id,
    label,
    expect,
    timeline: { ...timeline, assets },
    assetIds: kept,
    expectLint,
  };
}

export function buildScenarios(): Scenario[] {
  return [
    scenario(
      "single",
      "Single clip",
      "One clip on V1. Play it — video should show and the timecode should advance.",
      applyOps(base(), [clip("only", "asset-a", 0, 4_000)]),
      ["asset-a"],
    ),
    scenario(
      "boundary",
      "Two clips, hard cut",
      "Adjacent clips from different files. Play across the 4s cut — no freeze, no black flash.",
      applyOps(base(), [
        clip("first", "asset-a", 0, 4_000),
        clip("second", "asset-b", 4_000, 4_000),
      ]),
      ["asset-a", "asset-b"],
    ),
    scenario(
      "gap",
      "Clip with a gap after it",
      "Clip ends at 4s, next starts at 7s. Playing into the gap should show the gap state, not freeze.",
      applyOps(base(), [
        clip("first", "asset-a", 0, 4_000),
        clip("second", "asset-b", 7_000, 3_000),
      ]),
      ["asset-a", "asset-b"],
      ["gap"],
    ),
    scenario(
      "overlap",
      "Overlapping clips",
      "Two clips cover the same time. Linter should flag an overlap error; markers appear on the blocks.",
      applyOps(base(), [
        clip("first", "asset-a", 0, 4_000),
        clip("second", "asset-b", 2_000, 4_000),
      ]),
      ["asset-a", "asset-b"],
      ["overlap"],
    ),
    scenario(
      "trimmed",
      "Trimmed clip",
      "Clip starts 2s into the source. Playing should show the source from 2s, not from 0.",
      applyOps(base(), [clip("trimmed", "asset-a", 0, 3_000, "v1", 2_000)]),
      ["asset-a"],
    ),
    scenario(
      "flash",
      "Sub-frame clip",
      "A 60ms clip — under the flash-frame threshold. Linter should warn.",
      applyOps(base(), [clip("flash", "asset-a", 0, 60)]),
      ["asset-a"],
      ["flash-frame"],
    ),
    scenario(
      "two-tracks",
      "Video and audio tracks",
      "Clip on V1 and one on A1. Scrubbing should resolve against V1 (the video track).",
      applyOps(base(), [
        clip("v", "asset-a", 0, 4_000),
        clip("a", "asset-b", 0, 4_000, "a1"),
      ]),
      ["asset-a", "asset-b"],
    ),
  ];
}

export function findScenario(id: string): Scenario | undefined {
  return buildScenarios().find((s) => s.id === id);
}

/** Rule ids the linter reports for a scenario — used by the tests. */
export function lintRulesFor(scenario: Scenario): string[] {
  return [...new Set(lint(scenario.timeline).map((d) => d.rule))].sort();
}

export function assetsFor(scenario: Scenario): Asset[] {
  return scenario.assetIds.map((id) =>
    scenario.timeline.assets[id] ?? { id, kind: "video", duration: 60_000 },
  );
}
