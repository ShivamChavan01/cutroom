import { describe, expect, it, vi } from "vitest";
import { emptyTimeline, makeClip, putAsset, type Timeline } from "@cutroom/engine";
import { assistantConfiguration, requestProposal } from "./request";
import { parseProductionDocument } from "../production/document";

const before = { ...putAsset(emptyTimeline(), { id: "a", kind: "video", duration: 5000 }), clips: { c: makeClip({ id: "c", assetId: "a", trackId: "v1", start: 1000, duration: 1000, inPoint: 0, volume: 1 }) } };
const input = { prompt: "Fix the leading gap", before, selectedClipId: "c", playheadMs: 0, lockedTrackIds: [] };
const signal = new AbortController().signal;
describe("assistant client", () => {
  it("supplies recent conversational turns alongside the current timeline", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ summary: "No edits", ops: [] }));
    await requestProposal({ ...input, conversation: [{ role: "user", content: "Keep the introduction" }, { role: "assistant", content: "The introduction stays." }] }, signal, fetcher);
    const context = JSON.parse(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).context);
    expect(context.conversation).toEqual([{ role: "user", content: "Keep the introduction" }, { role: "assistant", content: "The introduction stays." }]);
    expect(context.clips).toBeDefined();
  });
  it("rejects edits to existing clips omitted from the bounded task context", async () => {
    const production = parseProductionDocument({ version: 1, brief: "Review the selected passage.", styleReferences: [], evidence: [], requirements: [] });
    const timeline: Timeline = { ...before, clips: { ...before.clips, ...Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`z${index}`, { ...before.clips.c, id: `z${index}`, start: index * 2000 }])) } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ summary: "Edit an omitted clip", ops: [{ type: "setVolume", clipId: "z99", volume: 0.5 }] }));
    await expect(requestProposal({ ...input, before: timeline, production }, signal, fetcher)).rejects.toThrow("outside the supplied production context");
    expect(timeline.clips.z99?.volume).toBe(1);
  });
  it("sends bounded production context and previews constraint regressions without editing", async () => {
    const production = parseProductionDocument({ version: 1, brief: "Preserve this whole statement.", styleReferences: [], evidence: [], requirements: [
      { id: "quote", label: "Whole statement", kind: "preserve", priority: "required", range: { assetId: "a", channel: "video", inMs: 0, outMs: 1000 } },
    ] });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ summary: "Remove statement", ops: [{ type: "deleteClip", clipId: "c" }] }));
    const result = await requestProposal({ ...input, production }, signal, fetcher);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(JSON.parse(body.context).kind).toBe("production-context");
    expect(JSON.parse(body.context).brief).toBe(production.brief);
    expect(result.production?.regression).toContain("Whole statement");
    expect(before.clips.c).toBeDefined();
  });
  it("accepts River configuration so the disclosure identifies the provider receiving metadata", async () => {
    const config = { provider: "River", model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", configured: true, accessRequired: true };
    expect(await assistantConfiguration(signal, vi.fn<typeof fetch>().mockResolvedValue(Response.json(config)))).toEqual(config);
  });
  it("reads the actual provider for the disclosure without requesting a key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"provider":"Groq","model":"openai/gpt-oss-120b","configured":true}'));
    expect(await assistantConfiguration(signal, fetcher)).toEqual({ provider: "Groq", model: "openai/gpt-oss-120b", configured: true, accessRequired: false });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/assistant/config");
  });
  it("reads the hosted access requirement and keeps the access code out of timeline context", async () => {
    const configFetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ provider: "Groq", model: "x", configured: true, accessRequired: true }));
    expect((await assistantConfiguration(signal, configFetcher)).accessRequired).toBe(true);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ summary: "No edits", ops: [] }));
    await requestProposal({ ...input, accessCode: " reviewer-code " }, signal, fetcher);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer reviewer-code" });
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain("reviewer-code");
  });
  it("reports unavailable routes and rejects malformed hosted configuration", async () => {
    await expect(assistantConfiguration(signal, vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>missing route</html>")))).rejects.toThrow("configuration");
    await expect(assistantConfiguration(signal, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ provider: "Groq", model: "x", configured: true, accessRequired: "true" })))).rejects.toThrow("configuration");
  });
  it.each([{}, null, { provider: "Unknown", model: "x", configured: true }, { provider: "Groq", model: 5, configured: true }, { provider: "Groq", model: "x", configured: "true" }])("rejects malformed provider configuration: %j", async (body) => {
    await expect(assistantConfiguration(signal, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body))))).rejects.toThrow("configuration");
  });
  it("requests and validates a preview without editing the timeline", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ summary: "Close gap", ops: [{ type: "moveClip", clipId: "c", start: 0 }] })));
    const result = await requestProposal(input, signal, fetcher);
    expect(result.after.clips.c?.start).toBe(0);
    expect(before.clips.c.start).toBe(1000);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/assistant/propose");
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(signal);
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain("API_KEY");
  });
  it("reports configuration errors and rejects model payloads before they can become edits", async () => {
    await expect(requestProposal(input, signal, vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":"Configure OpenAI"}', { status: 503 })))).rejects.toThrow("Configure OpenAI");
    await expect(requestProposal(input, signal, vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ops":[]}')))).rejects.toThrow();
    await expect(requestProposal(input, signal, vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON')))).rejects.toThrow();
    const fetcher = vi.fn<typeof fetch>();
    await expect(requestProposal({ ...input, prompt: "" }, signal, fetcher)).rejects.toThrow("Describe");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
