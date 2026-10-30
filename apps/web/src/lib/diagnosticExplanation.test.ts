import {expect, it} from "vitest";
import {applyOp, current, emptyTimeline, lint} from "@cutroom/engine";
import {createDemoProject} from "./demo/project";
import {explainDiagnostic} from "./diagnosticExplanation";

it("explains the actual 1200ms gap with precise bounds, track, and editorial uncertainty", () => {
  const timeline = current(createDemoProject().history);
  const gap = lint(timeline).find(item => item.rule === "gap");
  if (gap === undefined) throw new Error("Expected sample gap");
  const explanation = explainDiagnostic(timeline, gap);
  expect(gap.clipIds).toEqual(["opening", "middle"]);
  expect(explanation.location).toBe("1.80s to 3.00s on video track V1");
  expect(explanation.explanation).toContain("1.20 seconds");
  expect(explanation.explanation).toContain("Keep the pause if deliberate");
  const moved = applyOp(timeline, {type: "moveClip", clipId: "middle", start: 4000});
  const later = lint(moved).find(item => item.rule === "gap");
  expect(explainDiagnostic(moved, later!).location).toBe("1.80s to 4.00s on video track V1");
});
it("handles missing references and unknown rules without inventing timing or certainty", () => {
  const finding = {rule: "future-rule", key: "test", severity: "warning" as const, clipIds: ["missing"], message: "External check"};
  expect(explainDiagnostic(emptyTimeline(), finding)).toMatchObject({location: "Project media"});
  expect(explainDiagnostic(emptyTimeline(), finding).explanation).toContain("cannot decide editorial intent");
  expect(explainDiagnostic(emptyTimeline(), {...finding, rule: "missing-media", where: 2000}).explanation).toContain("does not test network or decoder");
});
