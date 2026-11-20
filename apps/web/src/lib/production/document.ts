export interface SourceRange {
  readonly assetId: string;
  readonly channel: "video" | "audio";
  readonly inMs: number;
  readonly outMs: number;
}

interface RequirementBase {
  readonly id: string;
  readonly label: string;
  readonly priority: "required" | "preferred";
}

export type ProductionRequirement = RequirementBase & (
  | { readonly kind: "duration"; readonly minMs: number; readonly maxMs: number }
  | { readonly kind: "preserve"; readonly range: SourceRange }
  | { readonly kind: "sequence"; readonly ranges: readonly SourceRange[]; readonly maxGapMs: number }
  | { readonly kind: "editorial"; readonly instruction: string; readonly evidenceIds: readonly string[] }
);

export interface ProductionEvidence {
  readonly id: string;
  readonly kind: "transcript" | "shot-note" | "continuity-note";
  readonly range: SourceRange;
  readonly text: string;
  readonly provenance: "user-provided";
}

export interface ProductionDocument {
  readonly version: 1;
  readonly brief: string;
  readonly styleReferences: readonly {
    readonly id: string;
    readonly label: string;
    readonly direction: string;
    readonly evidenceIds: readonly string[];
  }[];
  readonly requirements: readonly ProductionRequirement[];
  readonly evidence: readonly ProductionEvidence[];
}

export const MAX_PRODUCTION_DOCUMENT_CHARS = 2_000_000;

function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Production context must contain objects.");
  const value = Object.fromEntries(Object.entries(input));
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unknown field in production context.");
  return value;
}

function text(input: unknown, limit = 4000): string {
  if (typeof input !== "string" || !input.trim() || input.length > limit) throw new Error(`Production text must contain 1–${limit} characters.`);
  return input;
}

function millis(input: unknown): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0 || input > 604_800_000) throw new Error("Production times must be integer milliseconds within seven days.");
  return input;
}

function list(input: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(input) || input.length > max) throw new Error(`Production list must contain at most ${max} entries.`);
  return input;
}

function ids(input: unknown): readonly string[] {
  const values = list(input, 100).map(value => text(value, 200));
  if (new Set(values).size !== values.length) throw new Error("Duplicate production evidence reference.");
  return values;
}

function sourceRange(input: unknown): SourceRange {
  const value = object(input, ["assetId", "channel", "inMs", "outMs"]);
  if (value.channel !== "video" && value.channel !== "audio") throw new Error("Source ranges need an audio or video channel.");
  const range: SourceRange = { assetId: text(value.assetId, 200), channel: value.channel, inMs: millis(value.inMs), outMs: millis(value.outMs) };
  if (range.outMs <= range.inMs) throw new Error("Source ranges must have a positive duration.");
  return range;
}

function requirement(input: unknown): ProductionRequirement {
  const value = object(input, ["id", "label", "priority", "kind", "minMs", "maxMs", "range", "ranges", "maxGapMs", "instruction", "evidenceIds"]);
  if (value.priority !== "required" && value.priority !== "preferred") throw new Error("Choose required or preferred for each production requirement.");
  const base: RequirementBase = { id: text(value.id, 200), label: text(value.label, 500), priority: value.priority };
  switch (value.kind) {
    case "duration": {
      object(value, ["id", "label", "priority", "kind", "minMs", "maxMs"]);
      const minMs = millis(value.minMs), maxMs = millis(value.maxMs);
      if (minMs > maxMs) throw new Error("Minimum production duration exceeds its maximum.");
      return { ...base, kind: value.kind, minMs, maxMs };
    }
    case "preserve":
      object(value, ["id", "label", "priority", "kind", "range"]);
      return { ...base, kind: value.kind, range: sourceRange(value.range) };
    case "sequence": {
      object(value, ["id", "label", "priority", "kind", "ranges", "maxGapMs"]);
      const ranges = list(value.ranges, 30).map(sourceRange);
      if (ranges.length < 2) throw new Error("A continuity sequence needs at least two source ranges.");
      return { ...base, kind: value.kind, ranges, maxGapMs: millis(value.maxGapMs) };
    }
    case "editorial":
      object(value, ["id", "label", "priority", "kind", "instruction", "evidenceIds"]);
      return { ...base, kind: value.kind, instruction: text(value.instruction), evidenceIds: ids(value.evidenceIds) };
    default: throw new Error("Unsupported production requirement.");
  }
}

export function parseProductionDocument(input: unknown): ProductionDocument {
  if (typeof input === "string") {
    if (input.length > MAX_PRODUCTION_DOCUMENT_CHARS) throw new Error("Production context exceeds the two-million-character import limit.");
    try { input = JSON.parse(input); } catch { throw new Error("Production context is not valid JSON."); }
  }
  const value = object(input, ["version", "brief", "styleReferences", "requirements", "evidence"]);
  if (value.version !== 1) throw new Error("Unsupported production context version.");
  const styleReferences = list(value.styleReferences, 30).map(input => {
    const reference = object(input, ["id", "label", "direction", "evidenceIds"]);
    return { id: text(reference.id, 200), label: text(reference.label, 500), direction: text(reference.direction), evidenceIds: ids(reference.evidenceIds) };
  });
  const requirements = list(value.requirements, 100).map(requirement);
  const evidence = list(value.evidence, 20_000).map((input): ProductionEvidence => {
    const entry = object(input, ["id", "kind", "range", "text", "provenance"]);
    if (entry.kind !== "transcript" && entry.kind !== "shot-note" && entry.kind !== "continuity-note") throw new Error("Unsupported production evidence kind.");
    if (entry.provenance !== "user-provided") throw new Error("Evidence must explicitly identify itself as user-provided.");
    return { id: text(entry.id, 200), kind: entry.kind, range: sourceRange(entry.range), text: text(entry.text), provenance: entry.provenance };
  });
  for (const entries of [requirements, styleReferences, evidence]) {
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error("Duplicate production ID.");
  }
  const known = new Set(evidence.map(entry => entry.id));
  const references = [...styleReferences.flatMap(entry => entry.evidenceIds), ...requirements.flatMap(entry => entry.kind === "editorial" ? entry.evidenceIds : [])];
  if (references.some(id => !known.has(id))) throw new Error("Production context references missing evidence IDs.");
  const document: ProductionDocument = { version: 1, brief: text(value.brief, 12_000), styleReferences, requirements, evidence };
  if (JSON.stringify(document).length > MAX_PRODUCTION_DOCUMENT_CHARS) throw new Error("Production context exceeds the two-million-character import limit.");
  return document;
}
