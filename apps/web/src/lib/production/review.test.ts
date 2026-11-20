import { describe, expect, it } from "vitest";
import { applyOp, emptyTimeline, makeClip, putAsset, splitChildId } from "@cutroom/engine";
import { parseProductionDocument } from "./document";
import { assertProductionPreserved, reviewProduction, sourcePlacements } from "./review";

const range = { assetId: "interview", channel: "audio", inMs: 5000, outMs: 7000 } as const;
const document = parseProductionDocument({ version: 1, brief: "Keep the qualification in the customer's story.", styleReferences: [], evidence: [], requirements: [
  { id: "quote", label: "Qualification", kind: "preserve", priority: "required", range },
  { id: "duration", label: "Duration", kind: "duration", priority: "required", minMs: 2000, maxMs: 10_000 },
  { id: "wardrobe", label: "Wardrobe", kind: "editorial", priority: "required", instruction: "Confirm jacket consistency.", evidenceIds: [] },
] });
function fixture() {
  return applyOp(putAsset(emptyTimeline("production"), { id: "interview", kind: "audio", duration: 20_000 }), {
    type: "addClip", clip: makeClip({ id: "quote", assetId: "interview", trackId: "a1", start: 1000, inPoint: 5000, duration: 2000, volume: 1 }),
  });
}

describe("production requirement checks", () => {
  it("maps source time to timeline time and keeps human judgments unverified", () => {
    const timeline = fixture();
    expect(sourcePlacements(timeline, range)).toEqual([{ start: 1000, end: 3000, clipIds: ["quote"] }]);
    expect(reviewProduction(timeline, document).map(check => check.status)).toEqual(["pass", "pass", "needs-review"]);
  });
  it("keeps intact split segments valid, but rejects removed, displaced or muted words", () => {
    const before = fixture(), split = applyOp(before, { type: "splitClip", clipId: "quote", at: 1000 });
    expect(reviewProduction(split, document)[0]?.status).toBe("pass");
    const right = splitChildId("quote", 1000, "R");
    for (const op of [
      { type: "deleteClip", clipId: right }, { type: "moveClip", clipId: right, start: 2500 },
      { type: "setVolume", clipId: right, volume: 0 },
    ] as const) {
      const after = applyOp(split, op);
      expect(reviewProduction(after, document)[0]?.status).toBe("fail");
      expect(() => assertProductionPreserved(split, after, document)).toThrow("Qualification");
    }
    expect(reviewProduction({ ...before, tracks: before.tracks.map(track => ({ ...track, muted: true })) }, document)[0]?.status).toBe("fail");
  });
  it("does not double count duplicate overlapping ranges or accept source gaps", () => {
    const before = fixture();
    let after = applyOp(before, { type: "trimClip", clipId: "quote", duration: 1000 });
    after = applyOp(after, { type: "addClip", clip: { ...after.clips.quote!, id: "duplicate" } });
    expect(reviewProduction(after, document)[0]?.breaches[0]?.amount).toBe(1000);
  });
  it("reports unknown sources and impossible source bounds without claiming compliance", () => {
    for (const assets of [{}, { interview: { id: "interview", kind: "audio", duration: 6000 } }] as const) {
      expect(reviewProduction({ ...fixture(), assets }, document)[0]?.status).toBe("needs-review");
    }
  });
  it("rejects worsening existing failures but allows an actual improvement", () => {
    const before = applyOp(fixture(), { type: "trimClip", clipId: "quote", duration: 1500 });
    expect(() => assertProductionPreserved(before, applyOp(before, { type: "trimClip", clipId: "quote", duration: 1000 }), document)).toThrow();
    expect(() => assertProductionPreserved(before, fixture(), document)).not.toThrow();
  });
  it("checks narrative order and gaps, and flags ambiguous repeated takes", () => {
    const sequence = parseProductionDocument({ ...document, requirements: [{ id: "story", label: "Setup before payoff", kind: "sequence", priority: "required",
      ranges: [{ ...range, inMs: 1000, outMs: 2000 }, range], maxGapMs: 2000 }] });
    const timeline = applyOp(fixture(), { type: "addClip", clip: makeClip({ id: "setup", assetId: "interview", trackId: "a1", start: 0, inPoint: 1000, duration: 1000, volume: 1 }) });
    expect(reviewProduction(timeline, sequence)[0]?.status).toBe("pass");
    expect(reviewProduction(applyOp(timeline, { type: "moveClip", clipId: "quote", start: 5000 }), sequence)[0]?.status).toBe("fail");
    expect(reviewProduction(applyOp(timeline, { type: "moveClip", clipId: "setup", start: 4000 }), sequence)[0]?.status).toBe("fail");
    const repeated = applyOp(timeline, { type: "addClip", clip: { ...timeline.clips.quote!, id: "repeat", start: 8000 } });
    expect(reviewProduction(repeated, sequence)[0]?.status).toBe("needs-review");
  });
});
