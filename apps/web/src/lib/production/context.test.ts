import { describe, expect, it } from "vitest";
import { emptyTimeline, makeClip, type Timeline } from "@cutroom/engine";
import { parseProductionDocument } from "./document";
import { buildProductionContext } from "./context";

function fixture(size = 12_000) {
  const timeline: Timeline = { ...emptyTimeline("Synthetic production"),
    assets: { interview: { id: "interview", kind: "video", name: "customer.mp4", duration: 7_200_000 } },
    clips: Object.fromEntries(Array.from({ length: size }, (_, index) => {
      const id = `clip-${index}`;
      return [id, makeClip({ id, assetId: "interview", trackId: "v1", start: index * 1000, inPoint: index * 500, duration: 500, volume: 1 })];
    })),
  };
  const document = parseProductionDocument({ version: 1, brief: "A customer story with its qualification and consistent wardrobe.",
    styleReferences: [{ id: "style", label: "Reference scene", direction: "Use patient interview pacing.", evidenceIds: ["reference"] }],
    requirements: [{ id: "qualification", label: "Preserve qualifying statement", kind: "preserve", priority: "required",
      range: { assetId: "interview", channel: "audio", inMs: 5_000_000, outMs: 5_000_500 } }],
    evidence: [
      { id: "qualification", kind: "transcript", range: { assetId: "interview", channel: "audio", inMs: 5_000_000, outMs: 5_000_500 }, text: "Only after the staff training did the result improve.", provenance: "user-provided" },
      { id: "reference", kind: "continuity-note", range: { assetId: "interview", channel: "video", inMs: 3000, outMs: 3500 }, text: "Blue jacket and desk on the left in the authored reference note.", provenance: "user-provided" },
      ...Array.from({ length: 1000 }, (_, index) => ({ id: `distractor-${index}`, kind: "shot-note", range: { assetId: "interview", channel: "video", inMs: index * 1000, outMs: index * 1000 + 500 }, text: `Customer story unrelated take ${index}.`, provenance: "user-provided" })),
    ],
  });
  return { timeline, document, query: "Check continuity near the selected shot", selectedClipId: "clip-2", playheadMs: 2000, lockedTrackIds: ["v1"] };
}

describe("production context assembly", () => {
  it("retains the brief, style references and distant mandatory evidence in a large synthetic cut", () => {
    const input = fixture(), pack = buildProductionContext({ ...input, maxChars: 16_000 });
    expect(pack.requirements).toEqual(input.document.requirements);
    expect(pack.styleReferences).toEqual(input.document.styleReferences);
    expect(pack.evidence.map(entry => entry.fact.id)).toContain("qualification");
    expect(pack.evidence.map(entry => entry.fact.id)).toContain("reference");
    expect(pack.evidence.find(entry => entry.fact.id === "qualification")?.placements[0]?.start).toBe(10_000_000);
    expect(pack.clips.map(clip => clip.id)).toContain("clip-2");
    expect(pack.timeline.clipCount).toBe(12_000);
    expect(pack.clips.length).toBeLessThanOrEqual(60);
    expect(pack.coverage.omittedEvidence).toBeGreaterThan(0);
    expect(JSON.stringify(pack).length).toBeLessThanOrEqual(16_000);
    expect(pack.scope.lockedTrackIds).toEqual(["v1"]);
  });
  it("fails explicitly when mandatory context cannot fit instead of dropping constraints", () => {
    const input = fixture(10);
    expect(() => buildProductionContext({ ...input, document: { ...input.document, brief: "x".repeat(12_000) }, maxChars: 2000 })).toThrow("cannot be silently truncated");
    for (const maxChars of [0, NaN, 240_001, 2000.5]) expect(() => buildProductionContext({ ...input, maxChars })).toThrow("budget");
  });
  it("never silently drops explicitly referenced style evidence to meet the budget", () => {
    const input = fixture(10);
    const document = { ...input.document, evidence: input.document.evidence.map(entry => entry.id === "reference" ? { ...entry, text: "x".repeat(4000) } : entry) };
    expect(() => buildProductionContext({ ...input, document, maxChars: 4000 })).toThrow("Referenced production evidence exceeds");
  });
  it("keeps missing evidence unplaced and handles empty timelines and inherited selections", () => {
    const input = fixture(0), pack = buildProductionContext({ ...input, timeline: emptyTimeline(), selectedClipId: "constructor" });
    expect(pack.clips).toHaveLength(0);
    expect(pack.checks[0]?.status).toBe("needs-review");
    expect(pack.evidence.every(entry => entry.placements.length === 0)).toBe(true);
    expect(pack.coverage.retrieval).toContain("user-provided");
  });
});
