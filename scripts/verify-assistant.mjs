import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Deterministic browser QA substitutes the remote model response, not the engine.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5186";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(target).hostname));
assert.ok(process.env.TEST_VIDEO_A, "Set TEST_VIDEO_A to a local demo video");
const out = process.env.QA_OUTPUT_DIR ?? path.resolve(".gstack/assistant-qa");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checkpoints = [];
const plan = { summary: "There is a one-second gap before the second clip. Moving it to 3 seconds closes the gap without removing footage.", ops: [{ type: "moveClip", clipId: "ai-second", start: 3000 }] };
let mode = "config-error";
await page.route("**/api/assistant/propose", async (route) => {
  const request = route.request().postDataJSON();
  assert.ok(request.prompt);
  assert.ok(JSON.parse(request.context).issues);
  assert.ok(!JSON.stringify(request).includes("OPENAI_API_KEY"));
  if (mode === "config-error") return route.fulfill({ status: 503, json: { error: "Set OPENAI_API_KEY and OPENAI_MODEL in apps/web/.env.local, then restart the server." } });
  if (mode === "invalid") return route.fulfill({ json: { summary: "Bad output", ops: [{ type: "execute", clipId: "ai-second" }] } });
  if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 800));
  await route.fulfill({ json: plan }).catch(() => {});
});
async function capture(name) {
  assert.deepEqual(errors, []);
  checkpoints.push(name);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}
async function secondStart() {
  return page.evaluate(async () => (await import("/src/store.ts")).useEditorStore.getState().timeline.clips["ai-second"]?.start);
}
try {
  await page.goto(target);
  await page.locator("header input[type=file]").first().setInputFiles(process.env.TEST_VIDEO_A);
  await page.waitForFunction(() => document.querySelector(".studio-clip") !== null);
  await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/store.ts");
    const store = useEditorStore.getState();
    const clip = Object.values(store.timeline.clips)[0];
    if (!clip) throw new Error("No imported clip");
    store.dispatch({ type: "trimClip", clipId: clip.id, duration: 3000 });
    store.dispatch({ type: "addClip", clip: { ...clip, id: "ai-second", start: 4000, inPoint: 3000, duration: 3000, outPoint: 6000 } });
  });
  await page.getByRole("button", { name: "Issues", exact: true }).click();
  await page.getByRole("button", { name: "Explain issues with AI", exact: true }).click();
  const generate = page.getByRole("button", { name: "Explain & propose fixes", exact: true });
  await generate.click();
  await page.getByRole("alert").filter({ hasText: "OPENAI_API_KEY" }).waitFor();
  assert.equal(await secondStart(), 4000);
  await capture("configuration-error");
  mode = "plan";
  await generate.click();
  await page.getByRole("heading", { name: "Proposed fix", exact: true }).waitFor();
  await page.getByText("1 resolved · 0 introduced · 0 unchanged", { exact: true }).waitFor();
  assert.equal(await secondStart(), 4000);
  await capture("preview-before-mutation");
  await page.evaluate(async () => (await import("/src/store.ts")).useEditorStore.getState().dispatch({ type: "setVolume", clipId: "ai-second", volume: 0.8 }));
  const apply = page.getByRole("button", { name: "Apply 1 proposed edit", exact: true });
  await page.getByText("The timeline changed. Generate a new proposal before applying.", { exact: true }).waitFor();
  assert.ok(await apply.isDisabled());
  await capture("stale-proposal-blocked");
  await generate.click();
  await apply.waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].find((button) => button.textContent === "Apply 1 proposed edit")?.disabled);
  await apply.click();
  await page.getByRole("status").filter({ hasText: "Applied 1 edit" }).waitFor();
  assert.equal(await secondStart(), 3000);
  await page.keyboard.press("Control+z");
  assert.equal(await secondStart(), 4000);
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await secondStart(), 3000);
  await capture("apply-undo-redo");
  await page.waitForFunction(async () => (await import("/src/lib/persistence/persistenceStore.ts")).usePersistenceStore.getState().status === "saved");
  await page.reload();
  await page.waitForFunction(async () => (await import("/src/store.ts")).useEditorStore.getState().timeline.clips["ai-second"]?.start === 3000);
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await capture("reload-preserves-edits");
  await page.evaluate(async () => (await import("/src/store.ts")).useEditorStore.getState().dispatch({ type: "moveClip", clipId: "ai-second", start: 4000 }));
  await generate.click();
  await apply.waitFor();
  await page.getByRole("button", { name: "Lock track v1", exact: true }).click();
  await apply.click();
  await page.getByRole("alert").filter({ hasText: "locked" }).waitFor();
  assert.equal(await secondStart(), 4000);
  await page.getByRole("button", { name: "Lock track v1", exact: true }).click();
  await capture("lock-rechecked-on-apply");
  mode = "invalid";
  await generate.click();
  await page.getByRole("alert").filter({ hasText: "unsupported" }).waitFor();
  assert.equal(await secondStart(), 4000);
  await capture("invalid-model-response-rejected");
  mode = "slow";
  await generate.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForTimeout(1000);
  assert.equal(await page.getByRole("heading", { name: "Proposed fix", exact: true }).count(), 0);
  assert.equal(await secondStart(), 4000);
  await capture("cancel-does-not-publish");
  await writeFile(path.join(out, "results.json"), JSON.stringify({ checkpoints, errors, model: "HTTP fixture; no live OpenAI call", media: path.basename(process.env.TEST_VIDEO_A) }, null, 2));
  console.log(JSON.stringify({ passed: checkpoints.length, errors, out }));
} finally { await browser.close(); }
