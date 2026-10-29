import { describe, expect, it } from "vitest";
import { PLAN_RESPONSE_FORMAT, chatCompletionPlan } from "./chatCompletion";
import { parsePlan } from "../src/lib/assistant/proposal";

const response = (plan: unknown, finish_reason = "stop") => ({ choices: [{ finish_reason, message: { content: JSON.stringify(plan) } }] });
describe.each(["Groq", "River"] as const)("%s structured proposals", (provider) => {
  it("uses strict objects with required fields and six supported operation variants", () => {
    expect(PLAN_RESPONSE_FORMAT.json_schema.strict).toBe(true);
    expect(PLAN_RESPONSE_FORMAT.json_schema.schema.additionalProperties).toBe(false);
    const variants = PLAN_RESPONSE_FORMAT.json_schema.schema.properties.ops.items.anyOf;
    expect(variants).toHaveLength(6);
    for (const variant of variants) {
      expect(variant.additionalProperties).toBe(false);
      expect(variant.required).toEqual(Object.keys(variant.properties));
    }
  });
  it("normalizes nullable schema fields into engine optionals and preserves valid zeroes", () => {
    const plan = parsePlan(chatCompletionPlan(response({ summary: "Close the gap", ops: [
      { type: "moveClip", clipId: "c", start: 0, trackId: null },
      { type: "trimClip", clipId: "c", inPoint: 0, duration: null },
      { type: "setTransform", clipId: "c", x: 0, y: null, scaleX: null, scaleY: null, rotation: null },
    ] }), provider));
    expect(plan.ops).toEqual([{ type: "moveClip", clipId: "c", start: 0 }, { type: "trimClip", clipId: "c", inPoint: 0 }, { type: "setTransform", clipId: "c", x: 0 }]);
  });
  it.each([null, {}, { choices: [] }, { choices: [{ finish_reason: "length", message: {} }] }, { choices: [{ finish_reason: "stop", message: { refusal: "no" } }] }, { choices: [{ finish_reason: "stop", message: { content: "bad json" } }] }, response({ summary: "Bad", ops: null })])("rejects malformed, incomplete or refused responses: %j", (input) => {
    expect(() => chatCompletionPlan(input, provider)).toThrow();
  });
  it("leaves illegal nulls for the semantic validator to reject", () => {
    expect(() => parsePlan(chatCompletionPlan(response({ summary: "Bad", ops: [{ type: "moveClip", clipId: "c", start: null, trackId: null }] }), provider))).toThrow();
    expect(() => parsePlan(chatCompletionPlan(response({ summary: "Bad", ops: [{ type: "trimClip", clipId: "c", inPoint: null, duration: null }] }), provider))).toThrow();
  });
});
