function schema<T extends Readonly<Record<string, unknown>>>(properties: T) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const nullableNumber = { type: ["number", "null"] };
function operation(type: string, properties: Readonly<Record<string, unknown>> = {}) {
  return schema({ type: { type: "string", enum: [type] }, clipId: { type: "string" }, ...properties });
}

export const PLAN_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "cutroom_verification_proposal", strict: true,
    schema: schema({
      summary: { type: "string" },
      ops: { type: "array", items: { anyOf: [
        operation("deleteClip"),
        operation("splitClip", { at: { type: "number" } }),
        operation("moveClip", { start: { type: "number" }, trackId: { type: ["string", "null"] } }),
        operation("trimClip", { inPoint: nullableNumber, duration: nullableNumber }),
        operation("setVolume", { volume: { type: "number" } }),
        operation("setTransform", { x: nullableNumber, y: nullableNumber, scaleX: nullableNumber, scaleY: nullableNumber, rotation: nullableNumber }),
      ] } },
    }),
  },
};

function object(value: unknown, provider: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${provider} returned an invalid response.`);
  return Object.fromEntries(Object.entries(value));
}

export function chatCompletionPlan(input: unknown, provider: "Groq" | "River"): unknown {
  const response = object(input, provider);
  if (!Array.isArray(response.choices) || response.choices.length !== 1) throw new Error(`${provider} returned no proposal.`);
  const choice = object(response.choices[0], provider);
  const message = object(choice.message, provider);
  if (message.refusal) throw new Error(`${provider} declined this request. Try describing the issue differently.`);
  if (choice.finish_reason !== "stop") throw new Error(`${provider} did not complete the proposal. Try a smaller request.`);
  if (typeof message.content !== "string") throw new Error(`${provider} returned no proposal.`);
  const plan = object(JSON.parse(message.content), provider);
  if (!Array.isArray(plan.ops)) throw new Error(`${provider} returned an invalid proposal.`);
  // Strict schemas require nullable fields; the engine uses absent optionals.
  const optionals = ["trackId", "inPoint", "duration", "x", "y", "scaleX", "scaleY", "rotation"];
  return { ...plan, ops: plan.ops.map((input) => Object.fromEntries(Object.entries(object(input, provider)).filter(([key, value]) => value !== null || !optionals.includes(key)))) };
}
