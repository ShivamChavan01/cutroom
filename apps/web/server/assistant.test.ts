import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantHandler, responseText } from "./assistant";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function server(env: Record<string, string> = { OPENAI_API_KEY: "test-secret", OPENAI_MODEL: "test-model" }, upstream = vi.fn<typeof fetch>()) {
  const app = createServer(assistantHandler(env, upstream));
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => { app.closeAllConnections(); app.close((error) => error ? reject(error) : resolve()); }));
  const address = app.address();
  if (address === null || typeof address === "string") throw new Error("No listener");
  return { url: `http://127.0.0.1:${address.port}/api/assistant/propose`, upstream };
}

const body = JSON.stringify({ prompt: "Explain and fix gaps", context: '{"issues":[]}' });
const response = (text: string) => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] }));
const post = { method: "POST", headers: { "Content-Type": "application/json" }, body };

describe("OpenAI server boundary", () => {
  it("routes Groq with its own key and strict schema, then normalizes optional fields", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ summary: "Close gap", ops: [{ type: "moveClip", clipId: "c", start: 0, trackId: null }] }) } }] })));
    const app = await server({ AI_PROVIDER: "groq", GROQ_API_KEY: "groq-secret", OPENAI_API_KEY: "unrelated-secret" }, upstream);
    const result = await fetch(app.url, post);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ summary: "Close gap", ops: [{ type: "moveClip", clipId: "c", start: 0 }] });
    expect(upstream.mock.calls[0]?.[0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    const init = upstream.mock.calls[0]?.[1];
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer groq-secret" }));
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "openai/gpt-oss-120b", reasoning_effort: "low", response_format: { type: "json_schema", json_schema: { strict: true } } });
    expect(String(init?.body)).not.toContain("unrelated-secret");
  });
  it("exposes provider identity and readiness without exposing credentials or contacting the model", async () => {
    const app = await server({ AI_PROVIDER: "groq", GROQ_API_KEY: "groq-secret", GROQ_MODEL: "openai/gpt-oss-20b" });
    const result = await fetch(app.url.replace("propose", "config"));
    expect(await result.json()).toEqual({ provider: "Groq", model: "openai/gpt-oss-20b", configured: true });
    expect(app.upstream).not.toHaveBeenCalled();
    expect((await fetch(app.url.replace("propose", "config"), post)).status).toBe(405);
  });
  it.each([
    [{ AI_PROVIDER: "groq" }, "GROQ_API_KEY"],
    [{ AI_PROVIDER: "invalid", GROQ_API_KEY: "secret" }, "AI_PROVIDER"],
  ])("rejects incomplete provider configuration: %j", async (env, expected) => {
    const app = await server(env);
    const result = await fetch(app.url, post);
    expect(result.status).toBe(503);
    expect(await result.text()).toContain(expected);
    expect(app.upstream).not.toHaveBeenCalled();
  });
  it("reports Groq errors without leaking upstream details", async () => {
    const app = await server({ AI_PROVIDER: "groq", GROQ_API_KEY: "secret" }, vi.fn<typeof fetch>().mockResolvedValue(new Response("private", { status: 429 })));
    const result = await fetch(app.url, post);
    expect(result.status).toBe(502);
    const error = await result.text();
    expect(error).toContain("Groq rate or quota limit");
    expect(error).not.toContain("private");
  });
  it("posts only to OpenAI, keeps the key server-side, disables response storage and returns a plan", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(response('{"summary":"No issue","ops":[]}'));
    const app = await server(undefined, upstream);
    const result = await fetch(app.url, post);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ summary: "No issue", ops: [] });
    expect(upstream.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");
    const init = upstream.mock.calls[0]?.[1];
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer test-secret" }));
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "test-model", store: false, max_output_tokens: 5000, text: { format: { type: "json_object" } } });
  });
  it("explains missing configuration without contacting OpenAI", async () => {
    const app = await server({});
    const result = await fetch(app.url, post);
    expect(result.status).toBe(503);
    expect(await result.text()).toContain("OPENAI_API_KEY");
    expect(app.upstream).not.toHaveBeenCalled();
  });
  it.each([
    [{ method: "GET" }, 405],
    [{ ...post, headers: { "Content-Type": "text/plain" } }, 415],
    [{ ...post, body: "bad-json" }, 400],
    [{ ...post, body: JSON.stringify({ prompt: "", context: "{}" }) }, 400],
    [{ ...post, body: JSON.stringify({ prompt: "x".repeat(2001), context: "{}" }) }, 400],
    [{ ...post, body: JSON.stringify({ prompt: "x", context: "x".repeat(250_001) }) }, 400],
    [{ ...post, body: "x".repeat(1_100_001) }, 413],
    [{ ...post, headers: { "Content-Type": "application/json", Origin: "https://elsewhere.test" } }, 403],
    [{ ...post, headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" } }, 403],
    [{ ...post, headers: { "Content-Type": "application/json", Host: "elsewhere.test", Origin: "http://elsewhere.test" } }, 403],
  ])("rejects invalid requests before spending tokens: %j", async (init, status) => {
    const app = await server();
    expect((await fetch(app.url, init)).status).toBe(status);
    expect(app.upstream).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])("redacts upstream failures (%s)", async (status) => {
    const app = await server(undefined, vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive upstream text", { status })));
    const result = await fetch(app.url, post);
    expect(result.status).toBe(502);
    const error = await result.text();
    expect(error).not.toContain("sensitive");
    expect(error).not.toContain("test-secret");
  });
  it("rejects invalid model JSON, incomplete and refused output", async () => {
    const app = await server(undefined, vi.fn<typeof fetch>().mockResolvedValue(response("not JSON")));
    expect((await fetch(app.url, post)).status).toBe(502);
    expect(() => responseText({ status: "incomplete", output: [] })).toThrow("did not complete");
    expect(() => responseText({ status: "completed", output: [] })).toThrow("no proposal");
    expect(() => responseText({ status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] })).toThrow("declined");
    expect(() => responseText(null)).toThrow();
  });
  it("bounds concurrent paid requests and releases the slot after failure", async () => {
    let fail: (cause: Error) => void = () => { throw new Error("No pending request"); };
    const upstream = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue(response('{"summary":"Done","ops":[]}'));
    const app = await server(undefined, upstream);
    const pending = fetch(app.url, post);
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledOnce());
    expect((await fetch(app.url, post)).status).toBe(429);
    fail(new Error("network"));
    expect((await pending).status).toBe(502);
    expect((await fetch(app.url, post)).status).toBe(200);
  });
  it("aborts upstream work when the browser cancels", async () => {
    let signal: AbortSignal | null | undefined;
    const upstream = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      signal = init?.signal;
      return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    const app = await server(undefined, upstream);
    const controller = new AbortController();
    const pending = fetch(app.url, { ...post, signal: controller.signal }).catch(() => undefined);
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledOnce());
    controller.abort();
    await pending;
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });
});
