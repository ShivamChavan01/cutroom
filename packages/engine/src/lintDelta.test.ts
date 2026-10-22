import { describe, expect, it } from "vitest";
import {
  type Timeline,
  applyOps,
  clipRootId,
  diagnosticKey,
  emptyTimeline,
  lint,
  lintDelta,
  makeClip,
  putAsset,
} from "./index";

/** A timeline with one asset and one clip — the clean baseline. */
function cleanTimeline(): Timeline {
  let t = emptyTimeline("delta");
  t = putAsset(t, { id: "asset-a", kind: "video", duration: 30_000 });
  return applyOps(t, [
    {
      type: "addClip",
      clip: makeClip({
        id: "a", trackId: "v1", assetId: "asset-a",
        start: 0, inPoint: 0, duration: 4_000, volume: 1,
      }),
    },
  ]);
}

function addClip(
  timeline: Timeline,
  id: string,
  start: number,
  duration: number,
  trackId = "v1",
  assetId = "asset-a",
  inPoint = 0,
): Timeline {
  return applyOps(timeline, [
    {
      type: "addClip",
      clip: makeClip({
        id, trackId, assetId, start, inPoint, duration, volume: 1,
      }),
    },
  ]);
}

describe("diagnostic identity", () => {
  it("derives the key from the rule and the sorted root clip ids", () => {
    expect(diagnosticKey("overlap", ["b", "a"])).toBe("overlap|a,b|");
    expect(diagnosticKey("overlap", ["a", "b"])).toBe(diagnosticKey("overlap", ["b", "a"]));
  });

  it("ignores the message and the position", () => {
    // Same rule, same clips, different place: still the same problem.
    expect(diagnosticKey("gap", ["a", "b"])).toBe(diagnosticKey("gap", ["a", "b"]));
  });

  it("maps split children back to their parent", () => {
    expect(clipRootId("parent~4000~L~abc123")).toBe("parent");
    expect(clipRootId("plain")).toBe("plain");
  });

  it("includes a subject for rules that are not about clips", () => {
    expect(diagnosticKey("unused-asset", [], "asset-x")).toBe("unused-asset||asset-x");
    expect(diagnosticKey("unused-asset", [], "asset-x")).not.toBe(
      diagnosticKey("unused-asset", [], "asset-y"),
    );
  });
});

describe("lintDelta", () => {
  it("reports nothing for two identical timelines", () => {
    const t = cleanTimeline();
    const delta = lintDelta(t, t);

    expect(delta.introduced).toEqual([]);
    expect(delta.resolved).toEqual([]);
    expect(delta.unchanged).toBe(lint(t).length);
  });

  it("reports an introduced problem", () => {
    const before = cleanTimeline();
    const after = addClip(before, "b", 2_000, 2_000); // overlaps "a"
    const delta = lintDelta(before, after);

    expect(delta.introduced.map((d) => d.rule)).toEqual(["overlap"]);
    expect(delta.resolved).toEqual([]);
  });

  it("reports a resolved problem", () => {
    const before = addClip(cleanTimeline(), "b", 2_000, 2_000);
    const after = cleanTimeline();
    const delta = lintDelta(before, after);

    expect(delta.resolved.map((d) => d.rule)).toEqual(["overlap"]);
    expect(delta.introduced).toEqual([]);
  });

  it("keeps the same identity when a clip moves", () => {
    // The diagnostic's position changes, but it is the same problem.
    const before = addClip(cleanTimeline(), "b", 2_000, 2_000);
    const after = applyOps(before, [
      { type: "moveClip", clipId: "b", start: 3_000 },
    ]);
    const delta = lintDelta(before, after);

    expect(delta.introduced).toEqual([]);
    expect(delta.resolved).toEqual([]);
    expect(delta.unchanged).toBe(1);
  });

  it("does not manufacture a new problem when a clip is split", () => {
    // Splitting tiles the parent exactly, so the overlap the parent had
    // must still be the overlap the children have — one identity, not two.
    const before = addClip(cleanTimeline(), "b", 2_000, 2_000);
    const after = applyOps(before, [
      { type: "splitClip", clipId: "b", at: 1_000 },
    ]);
    const delta = lintDelta(before, after);

    expect(delta.introduced).toEqual([]);
    expect(delta.resolved).toEqual([]);
    expect(delta.unchanged).toBe(1);
  });

  it("counts identities, not raw diagnostics", () => {
    // Splitting in the middle of an overlap leaves two overlapping children
    // that share one identity.
    const before = addClip(cleanTimeline(), "b", 1_000, 4_000);
    const after = applyOps(before, [
      { type: "splitClip", clipId: "b", at: 2_000 },
    ]);
    const rawAfter = lint(after).filter((d) => d.rule === "overlap");
    const delta = lintDelta(before, after);

    expect(rawAfter.length).toBeGreaterThan(1);
    expect(delta.unchanged).toBe(1);
    expect(delta.introduced).toEqual([]);
  });
});

/**
 * Defect injection: build a timeline with one known defect, assert the
 * linter catches exactly that rule, and assert a clean timeline produces
 * no diagnostics at all. The counts are reported in the test names so a
 * failure says what the catch rate was.
 */
describe("defect injection", () => {
  const DEFECTS = [
    {
      name: "overlap",
      build: (t: Timeline): Timeline => addClip(t, "b", 2_000, 2_000),
      rule: "overlap",
    },
    {
      name: "gap",
      build: (t: Timeline): Timeline => addClip(t, "b", 9_000, 2_000),
      rule: "gap",
    },
    {
      name: "missing-media",
      build: (t: Timeline): Timeline => addClip(t, "b", 9_000, 2_000, "v1", "ghost"),
      rule: "missing-media",
    },
    {
      name: "trim-past-source",
      build: (t: Timeline): Timeline => addClip(t, "b", 9_000, 2_000, "v1", "asset-a", 29_500),
      rule: "trim-past-source",
    },
  ] as const;

  it("catches every injected defect (4/4) and raises no false alarms (0)", () => {
    let caught = 0;
    let falseAlarms = 0;

    // Baseline: a clean timeline must be silent.
    const clean = cleanTimeline();
    const cleanDiagnostics = lint(clean);
    falseAlarms += cleanDiagnostics.length;

    for (const defect of DEFECTS) {
      const broken = defect.build(clean);
      const found = lint(broken).some((d) => d.rule === defect.rule);
      if (found) caught += 1;
      else {
        throw new Error(
          `defect "${defect.name}" was not caught (expected rule ${defect.rule})`,
        );
      }
    }

    expect(caught).toBe(4);
    expect(falseAlarms).toBe(0);
  });

  it("catches a zero-length clip (5/5) even though the reducer refuses to make one", () => {
    // The reducer throws on a zero-length clip, so this state can only
    // arrive by hand — which is exactly why the linter is the backstop.
    const broken: Timeline = {
      ...cleanTimeline(),
      clips: {
        ...cleanTimeline().clips,
        dead: {
          id: "dead", trackId: "v1", assetId: "asset-a",
          start: 9_000, inPoint: 0, duration: 0, volume: 1, outPoint: 0,
        },
      },
    };
    expect(lint(broken).some((d) => d.rule === "zero-length")).toBe(true);
  });

  it("catches a flash-frame clip (6/6)", () => {
    const broken = addClip(cleanTimeline(), "flash", 9_000, 60);
    expect(lint(broken).some((d) => d.rule === "flash-frame")).toBe(true);
  });

  it("raises no diagnostics on a clean timeline (0 false alarms)", () => {
    expect(lint(cleanTimeline())).toEqual([]);
  });
});
