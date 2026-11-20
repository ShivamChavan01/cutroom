import type { Timeline } from "@cutroom/engine";
import { assistantContext, parsePlan, previewPlan } from "./proposal";
import type { ProductionDocument } from "../production/document";
import { buildProductionContext } from "../production/context";
import { recentConversation, type ConversationMessage } from "./conversation";

export async function assistantConfiguration(signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const response = await fetcher("/api/assistant/config", { signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== "object" || body === null || !("provider" in body) || (body.provider !== "Groq" && body.provider !== "OpenAI" && body.provider !== "River") || !("model" in body) || typeof body.model !== "string" || !("configured" in body) || typeof body.configured !== "boolean" || ("accessRequired" in body && typeof body.accessRequired !== "boolean")) {
    throw new Error("Could not read the AI provider configuration. Check the server deployment.");
  }
  return { provider: body.provider, model: body.model, configured: body.configured, accessRequired: "accessRequired" in body && body.accessRequired === true };
}

export async function requestProposal(input: { prompt: string; before: Timeline; selectedClipId: string | null; playheadMs: number; lockedTrackIds: readonly string[]; accessCode?: string; production?: ProductionDocument | null; conversation?: readonly ConversationMessage[] }, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!input.prompt.trim() || input.prompt.length > 2000) throw new Error("Describe the issue in 1–2,000 characters.");
  const production = input.production == null ? null : buildProductionContext({ document: input.production, timeline: input.before, query: input.prompt,
    selectedClipId: input.selectedClipId, playheadMs: input.playheadMs, lockedTrackIds: input.lockedTrackIds });
  const currentContext: unknown = production ?? JSON.parse(assistantContext(input.before, input.selectedClipId, input.playheadMs, input.lockedTrackIds));
  if (typeof currentContext !== "object" || currentContext === null) throw new Error("Could not build assistant context.");
  const context = JSON.stringify({ ...currentContext, conversation: recentConversation(input.conversation ?? []) });
  if (context.length > 250_000) throw new Error("This timeline and conversation are too large for the assistant. Use a smaller sequence.");
  const response = await fetcher("/api/assistant/propose", {
    method: "POST", headers: { "Content-Type": "application/json", ...(input.accessCode?.trim() ? { Authorization: `Bearer ${input.accessCode.trim()}` } : {}) }, signal,
    body: JSON.stringify({ prompt: input.prompt, context }),
  });
  const body: unknown = await response.json().catch(() => { throw new Error("The assistant server returned an invalid response. Check the deployment and retry."); });
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "The assistant could not generate a proposal. Try again.";
    throw new Error(message);
  }
  const plan = parsePlan(body);
  if (production !== null && plan.ops.some(op => "clipId" in op && !production.clips.some(clip => clip.id === op.clipId))) {
    throw new Error("The assistant proposed editing a clip outside the supplied production context. Refine the request.");
  }
  return previewPlan(input.before, plan, input.lockedTrackIds, input.production ?? null);
}
