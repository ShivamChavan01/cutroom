import { parseProductionDocument, type ProductionDocument, type ProductionRequirement } from "./document";

export interface ProductionDraft {
  readonly brief: string;
  readonly style: string;
  readonly continuity: string;
  readonly seconds: string;
}

const owned = (id: string, prefix: string, label: string, expected: string) =>
  new RegExp(`^${prefix}-\\d+$`).test(id) && label === expected;
const styleLabel = "Reference style direction";
const continuityLabel = "Continuity requirement";
const durationLabel = "Maximum deliverable duration";
const formStyle = (entry: ProductionDocument["styleReferences"][number]) => owned(entry.id, "style", entry.label, styleLabel) && entry.evidenceIds.length === 0;
const formContinuity = (entry: ProductionRequirement) => entry.kind === "editorial" && entry.priority === "required" && owned(entry.id, "continuity", entry.label, continuityLabel) && entry.evidenceIds.length === 0;
const formDuration = (entry: ProductionRequirement) => entry.kind === "duration" && entry.priority === "required" && entry.minMs === 0 && owned(entry.id, "duration", entry.label, durationLabel);

export function productionDraft(document: ProductionDocument | null): ProductionDraft {
  const style = document?.styleReferences.filter(formStyle).at(-1);
  const continuity = document?.requirements.filter(formContinuity).at(-1);
  const duration = document?.requirements.filter(formDuration).at(-1);
  return { brief: document?.brief ?? "", style: style?.direction ?? "", continuity: continuity?.kind === "editorial" ? continuity.instruction : "", seconds: duration?.kind === "duration" ? String(duration.maxMs / 1000) : "" };
}

export function nextProductionId(prefix: string, document: ProductionDocument): string {
  const known = new Set([...document.requirements, ...document.styleReferences, ...document.evidence].map(entry => entry.id));
  let index = 1;
  while (known.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

/** The simple form replaces its own settings; imported rules and source notes retain their identity. */
export function saveProductionDraft(document: ProductionDocument | null, draft: ProductionDraft): ProductionDocument {
  const base: ProductionDocument = document ?? { version: 1, brief: draft.brief, styleReferences: [], requirements: [], evidence: [] };
  let next: ProductionDocument = { ...base, brief: draft.brief,
    styleReferences: base.styleReferences.filter(entry => !formStyle(entry)),
    requirements: base.requirements.filter(entry => !formContinuity(entry) && !formDuration(entry)),
  };
  if (draft.style.trim()) next = { ...next, styleReferences: [...next.styleReferences, { id: base.styleReferences.find(formStyle)?.id ?? nextProductionId("style", base), label: styleLabel, direction: draft.style, evidenceIds: [] }] };
  if (draft.continuity.trim()) next = { ...next, requirements: [...next.requirements, { id: base.requirements.find(formContinuity)?.id ?? nextProductionId("continuity", base), label: continuityLabel, priority: "required", kind: "editorial", instruction: draft.continuity, evidenceIds: [] }] };
  if (draft.seconds.trim()) {
    const maxMs = Number(draft.seconds) * 1000;
    if (!Number.isSafeInteger(maxMs) || maxMs <= 0) throw new Error("Enter a positive target duration in seconds.");
    next = { ...next, requirements: [...next.requirements, { id: base.requirements.find(formDuration)?.id ?? nextProductionId("duration", base), label: durationLabel, priority: "required", kind: "duration", minMs: 0, maxMs }] };
  }
  return parseProductionDocument(next);
}
