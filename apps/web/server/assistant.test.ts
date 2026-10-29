import { createServer, request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantHandler, responseText } from "./assistant";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function server(env: Record<string, string> = { OPENAI_API_KEY: "test-secret", OPENAI_MODEL: "test-model" }, upstream = vi.fn<typeof fetch>(), options: { hosted?: boolean; parsedBody?: unknown } = {}) {
  const handler = assistantHandler(env, upstream, options);
  const app = createServer((request, response) => {
    if (options.parsedBody !== undefined) {
      request.resume();
      void handler(Object.assign(request, { body: options.parsedBody }), response);
    } else void handler(request, response);
  });
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
  it.each([[undefined, "legacy-secret"], ["", "legacy-secret"], ["river-secret", "river-secret"]])("supports the existing River MODEL_API secret while preferring RIVER_API_KEY (%s)", async (key, expected) => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"summary":"No edits","ops":[]}' } }] }));
    const app = await server({ AI_PROVIDER: "river", MODEL_API: "legacy-secret", ...(key === undefined ? {} : { RIVER_API_KEY: key }) }, upstream);
    expect((await fetch(app.url, post)).status).toBe(200);
    expect(upstream.mock.calls[0]?.[1]?.headers).toEqual(expect.objectContaining({ Authorization: `Bearer ${expected}` }));
  });
  it.each(["groq", "openai"])("never uses the River MODEL_API credential for %s", async (provider) => {
    const app = await server({ AI_PROVIDER: provider, MODEL_API: "legacy-secret", OPENAI_MODEL: "test-model" });
    expect((await fetch(app.url, post)).status).toBe(503);
    expect(app.upstream).not.toHaveBeenCalled();
  });
  it.each([[undefined, "low"], ["zai-org/GLM-5.3-Flash", "low"], ["moonshotai/Kimi-K3", "none"], ["nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4", "none"]])("routes River using its documented token budget, reasoning and schema (%s)", async (model, effort) => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { reasoning_content: "Private reasoning", content: JSON.stringify({ summary: "Close gap", ops: [{ type: "moveClip", clipId: "c", start: 0, trackId: null }] }) } }] })));
    const app = await server({ AI_PROVIDER: "river", RIVER_API_KEY: "river-secret", ...(model ? { RIVER_MODEL: model } : {}), GROQ_API_KEY: "unrelated-secret" }, upstream);
    const result = await fetch(app.url, post);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ summary: "Close gap", ops: [{ type: "moveClip", clipId: "c", start: 0 }] });
    expect(upstream.mock.calls[0]?.[0]).toBe("https://api.river.ai/v1/chat/completions");
    const init = upstream.mock.calls[0]?.[1];
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer river-secret" }));
    const sent = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({ model: model ?? "deepseek-ai/DeepSeek-V4.1-Flash-1017", max_tokens: 5000, reasoning_effort: effort, response_format: { type: "json_schema", json_schema: { strict: true } } });
    expect(sent).not.toHaveProperty("max_completion_tokens");
    expect(String(init?.body)).not.toContain("unrelated-secret");
    const config = await fetch(app.url.replace("propose", "config"));
    expect(await config.json()).toEqual({ provider: "River", model: model ?? "deepseek-ai/DeepSeek-V4.1-Flash-1017", configured: true });
  });
  it("reports missing River credentials without contacting any provider", async () => {
    const app = await server({ AI_PROVIDER: "river" });
    const result = await fetch(app.url, post);
    expect(result.status).toBe(503);
    expect(await result.text()).toContain("RIVER_API_KEY");
    expect(app.upstream).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])("redacts River upstream failures (%s)", async (status) => {
    const app = await server({ AI_PROVIDER: "river", RIVER_API_KEY: "river-secret" }, vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive provider error", { status })));
    const result = await fetch(app.url, post);
    expect(result.status).toBe(502);
    const error = await result.text();
    expect(error).toContain("River");
    expect(error).not.toContain("river-secret");
    expect(error).not.toContain("sensitive provider error");
  });
  it("rejects incomplete River output instead of treating it as a proposal", async () => {
    const app = await server({ AI_PROVIDER: "river", RIVER_API_KEY: "river-secret" }, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] })));
    const result = await fetch(app.url, post);
    expect(result.status).toBe(502);
    expect(await result.text()).toContain("River did not complete");
  });
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

// Node's fetch owns the Host header. Use an actual HTTP request to exercise
// the same Host/Origin pairing that Vercel forwards in production.
function hostedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers)) }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end(init.body);
  });
}

describe("hosted assistant boundary", () => {
  const env = { AI_PROVIDER: "groq", GROQ_API_KEY: "provider-secret", ASSISTANT_ACCESS_CODE: "reviewer-code" };
  const headers = { "Content-Type": "application/json", Host: "cutroom-editor.vercel.app", Origin: "https://cutroom-editor.vercel.app", Authorization: "Bearer reviewer-code" };
  const plan = { summary: "Review these findings", ops: [] };
  const upstream = () => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(plan) } }] })));

  it("serves safe configuration on the deployed host and fails closed without an access code", async () => {
    const app = await server({ AI_PROVIDER: "groq", GROQ_API_KEY: "provider-secret" }, upstream(), { hosted: true });
    const result = await hostedFetch(app.url.replace("propose", "config"), { headers });
    expect(await result.json()).toEqual({ provider: "Groq", model: "openai/gpt-oss-120b", configured: false, accessRequired: true });
    const denied = await hostedFetch(app.url, { ...post, headers });
    expect(denied.status).toBe(503);
    expect(await denied.text()).not.toContain("provider-secret");
    expect(app.upstream).not.toHaveBeenCalled();
  });
  it.each(["", "Bearer wrong-code", "reviewer-code", "Bearer provider-secret"])("rejects invalid authorization without contacting the provider: %s", async (authorization) => {
    const app = await server(env, upstream(), { hosted: true });
    expect((await hostedFetch(app.url, { ...post, headers: { ...headers, Authorization: authorization } })).status).toBe(401);
    expect(app.upstream).not.toHaveBeenCalled();
  });
  it("accepts the reviewer code, including a routing query, without sending that code upstream", async () => {
    const app = await server(env, upstream(), { hosted: true });
    const result = await hostedFetch(`${app.url}?action=propose`, { ...post, headers });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(plan);
    expect(JSON.stringify(app.upstream.mock.calls)).not.toContain("reviewer-code");
    expect(app.upstream.mock.calls[0]?.[1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer provider-secret" }));
  });
  it.each([JSON.parse(body), body, Buffer.from(body)])("accepts Vercel's already-parsed body as well as raw body representations", async (parsedBody) => {
    const app = await server(env, upstream(), { hosted: true, parsedBody });
    expect((await hostedFetch(app.url, { ...post, headers })).status).toBe(200);
    expect(app.upstream).toHaveBeenCalledOnce();
  });
  it.each([[null, 400], [[], 400], ["bad JSON", 400], [{ prompt: "x", context: "x".repeat(250_001) }, 400], ["x".repeat(1_100_001), 413]])("rejects invalid parsed request bodies before calling the provider", async (parsedBody, status) => {
    const app = await server(env, upstream(), { hosted: true, parsedBody });
    expect((await hostedFetch(app.url, { ...post, headers })).status).toBe(status);
    expect(app.upstream).not.toHaveBeenCalled();
  });
  it("preserves cross-origin protection even with the correct access code", async () => {
    const app = await server(env, upstream(), { hosted: true });
    expect((await hostedFetch(app.url, { ...post, headers: { ...headers, Origin: "https://elsewhere.test" } })).status).toBe(403);
    expect(app.upstream).not.toHaveBeenCalled();
    expect((await hostedFetch(app.url.replace("propose", "unknown"), { headers })).status).toBe(404);
    expect((await hostedFetch(app.url.replace("/api/assistant/propose", "//["), { headers })).status).toBe(400);
  });
  it("exports an authenticated Vercel entry point using the same server handler", async () => {
    const provider = upstream();
    vi.stubGlobal("fetch", provider);
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "provider-secret");
    vi.stubEnv("ASSISTANT_ACCESS_CODE", "reviewer-code");
    try {
      const { default: handler } = await import("../../../api/assistant/[action]");
      const app = createServer(handler);
      await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
      cleanups.push(() => new Promise<void>((resolve, reject) => { app.closeAllConnections(); app.close((error) => error ? reject(error) : resolve()); }));
      const address = app.address();
      if (address === null || typeof address === "string") throw new Error("No listener");
      const url = `http://127.0.0.1:${address.port}/api/assistant/propose`;
      expect((await hostedFetch(url, { ...post, headers: { ...headers, Authorization: "" } })).status).toBe(401);
      expect(provider).not.toHaveBeenCalled();
      const result = await hostedFetch(url, { ...post, headers });
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual(plan);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
