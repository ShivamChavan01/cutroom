import { describe, expect, it } from "vitest";
import { parseProductionDocument } from "./document";

export const briefDocument = {
  version: 1,
  brief: "A customer story: introduce the problem, demonstrate the result, retain the qualification.",
  styleReferences: [{ id: "style", label: "Reference pacing", direction: "Give the customer time to finish each thought.", evidenceIds: ["quote"] }],
  requirements: [
    { id: "length", label: "Deliverable duration", priority: "required", kind: "duration", minMs: 4000, maxMs: 12_000 },
    { id: "qualification", label: "Retain qualification", priority: "required", kind: "preserve", range: { assetId: "interview", channel: "audio", inMs: 5000, outMs: 7000 } },
    { id: "story", label: "Problem before result", priority: "required", kind: "sequence", ranges: [{ assetId: "interview", channel: "audio", inMs: 1000, outMs: 2000 }, { assetId: "interview", channel: "audio", inMs: 5000, outMs: 7000 }], maxGapMs: 4000 },
    { id: "wardrobe", label: "Wardrobe continuity", priority: "required", kind: "editorial", instruction: "Confirm the same jacket across the scene.", evidenceIds: ["quote"] },
  ],
  evidence: [{ id: "quote", kind: "transcript", range: { assetId: "interview", channel: "audio", inMs: 5000, outMs: 7000 }, text: "It helped, but only after staff training.", provenance: "user-provided" }],
};

describe("production context import", () => {
  it("constructs an independent validated document from object or JSON input", () => {
    const parsed = parseProductionDocument(briefDocument);
    expect(parsed).toEqual(briefDocument);
    expect(parsed).not.toBe(briefDocument);
    expect(parsed.requirements).not.toBe(briefDocument.requirements);
    expect(parseProductionDocument(JSON.stringify(briefDocument))).toEqual(parsed);
  });
  it.each([null, [], "bad JSON", {}, { ...briefDocument, version: 2 }, { ...briefDocument, brief: "" },
    { ...briefDocument, extra: true }, { ...briefDocument, evidence: null }, { ...briefDocument, requirements: Array(101).fill(briefDocument.requirements[0]) },
  ])("rejects malformed boundaries: %j", input => expect(() => parseProductionDocument(input)).toThrow());
  it.each([
    { id: "bad", label: "Bad", priority: "required", kind: "duration", minMs: 2000, maxMs: 1000 },
    { id: "bad", label: "Bad", priority: "required", kind: "preserve", range: { assetId: "a", inMs: 0, outMs: 0 } },
    { id: "bad", label: "Bad", priority: "required", kind: "preserve", range: { assetId: "a", inMs: NaN, outMs: 1000 } },
    { id: "bad", label: "Bad", priority: "required", kind: "sequence", ranges: [], maxGapMs: 0 },
    { id: "bad", label: "Bad", priority: "optional", kind: "editorial", instruction: "x", evidenceIds: [] },
    { id: "bad", label: "Bad", priority: "required", kind: "duration", minMs: 0, maxMs: 1000, range: {} },
  ])("rejects invalid or contradictory requirement shapes", requirement => {
    expect(() => parseProductionDocument({ ...briefDocument, requirements: [requirement] })).toThrow();
  });
  it("rejects duplicate IDs, dangling references and invented analysis provenance", () => {
    expect(() => parseProductionDocument({ ...briefDocument, evidence: [...briefDocument.evidence, ...briefDocument.evidence] })).toThrow("Duplicate");
    expect(() => parseProductionDocument({ ...briefDocument, evidence: [] })).toThrow("missing evidence");
    expect(() => parseProductionDocument({ ...briefDocument, evidence: [{ ...briefDocument.evidence[0], provenance: "AI verified" }] })).toThrow("user-provided");
  });
});
