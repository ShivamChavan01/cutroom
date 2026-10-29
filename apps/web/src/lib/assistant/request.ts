import type { Timeline } from "@cutroom/engine";
import { assistantContext, parsePlan, previewPlan } from "./proposal";

export async function assistantConfiguration(signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const response = await fetcher("/api/assistant/config", { signal });
  const body: unknown = await response.json();
  if (!response.ok || typeof body !== "object" || body === null || !("provider" in body) || (body.provider !== "Groq" && body.provider !== "OpenAI") || !("model" in body) || typeof body.model !== "string" || !("configured" in body) || typeof body.configured !== "boolean") {
    throw new Error("Could not read the AI provider configuration. Check the local server.");
  }
  return { provider: body.provider, model: body.model, configured: body.configured };
}

export async function requestProposal(input: { prompt: string; before: Timeline; selectedClipId: string | null; playheadMs: number; lockedTrackIds: readonly string[] }, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!input.prompt.trim() || input.prompt.length > 2000) throw new Error("Describe the issue in 1–2,000 characters.");
  const context = assistantContext(input.before, input.selectedClipId, input.playheadMs, input.lockedTrackIds);
  const response = await fetcher("/api/assistant/propose", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ prompt: input.prompt, context }),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "The assistant could not generate a proposal. Try again.";
    throw new Error(message);
  }
  return previewPlan(input.before, parsePlan(body), input.lockedTrackIds);
}
