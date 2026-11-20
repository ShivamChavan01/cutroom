import { expect, it } from "vitest";
import { parseProductionDocument } from "./document";
import { productionDraft, saveProductionDraft } from "./form";

const draft = { brief: "Keep the story", style: "Patient pace", continuity: "Keep the geography", seconds: "6" };
it("updates and removes form settings instead of accumulating conflicting requirements", () => {
  const first = saveProductionDraft(null, draft);
  expect(productionDraft(first)).toEqual(draft);
  const next = saveProductionDraft(first, { ...draft, seconds: "10" });
  expect(next.requirements.filter(entry => entry.kind === "duration")).toHaveLength(1);
  expect(next.requirements.map(entry => entry.id)).toEqual(first.requirements.map(entry => entry.id));
  expect(productionDraft(next).seconds).toBe("10");
  expect(first.requirements.find(entry => entry.kind === "duration")?.maxMs).toBe(6000);
  const cleared = saveProductionDraft(next, { brief: draft.brief, style: "", continuity: "", seconds: "" });
  expect(cleared.requirements).toEqual([]);
  expect(cleared.styleReferences).toEqual([]);
});
it("keeps imported evidence links and richer constraints even when their IDs resemble form settings", () => {
  const document = parseProductionDocument({ version: 1, brief: draft.brief,
    evidence: [{ id: "note", kind: "shot-note", provenance: "user-provided", range: { assetId: "a", channel: "video", inMs: 0, outMs: 1000 }, text: "Reference frame" }],
    styleReferences: [{ id: "style-1", label: "Reference style direction", direction: "Use this frame", evidenceIds: ["note"] }],
    requirements: [
      { id: "continuity-1", label: "Continuity requirement", kind: "editorial", priority: "required", instruction: "Match the shot", evidenceIds: ["note"] },
      { id: "duration-1", label: "Maximum deliverable duration", kind: "duration", priority: "required", minMs: 2000, maxMs: 8000 },
    ],
  });
  const next = saveProductionDraft(document, { ...productionDraft(document), brief: "Revised brief" });
  expect(next.styleReferences).toEqual(document.styleReferences);
  expect(next.requirements).toEqual(document.requirements);
  expect(next.evidence).toEqual(document.evidence);
});
it("repairs legacy form duplicates while retaining independent imported rules and evidence", () => {
  const first = saveProductionDraft(null, draft);
  const document = parseProductionDocument({ ...first, requirements: [...first.requirements,
    { id: "duration-2", label: "Maximum deliverable duration", kind: "duration", priority: "required", minMs: 0, maxMs: 10000 },
    { id: "client-limit", label: "Client constraint", kind: "duration", priority: "required", minMs: 2000, maxMs: 15000 },
  ] });
  expect(productionDraft(document).seconds).toBe("10");
  const next = saveProductionDraft(document, productionDraft(document));
  expect(next.requirements.filter(entry => entry.kind === "duration")).toHaveLength(2);
  expect(next.requirements.find(entry => entry.id === "client-limit")).toEqual(document.requirements.at(-1));
  expect(next.evidence).toEqual(document.evidence);
});
it.each(["0", "-2", "bad", "Infinity", "0.0001", "604801"])("rejects invalid duration %s without modifying the saved document", seconds => {
  const document = saveProductionDraft(null, draft);
  expect(() => saveProductionDraft(document, { ...draft, seconds })).toThrow();
  expect(productionDraft(document)).toEqual(draft);
});
it("requires a nonempty brief and initializes an empty draft", () => {
  expect(productionDraft(null)).toEqual({ brief: "", style: "", continuity: "", seconds: "" });
  expect(() => saveProductionDraft(null, { ...draft, brief: " " })).toThrow();
});
