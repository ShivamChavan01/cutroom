import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = new URL(process.env.EDITOR_URL ?? "http://127.0.0.1:5191/?demo=1");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
assert.equal(target.searchParams.get("demo"), "1", "Use the isolated local sample workspace");
const out = path.resolve(process.env.QA_OUTPUT_DIR ?? ".gstack/production-context");
await mkdir(out, { recursive: true });
const document = JSON.parse(await readFile(new URL("../examples/production-context.demo.json", import.meta.url), "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(12_000);
const errors = [], results = [], requests = [];
let proposal = { summary: "Controlled response: mute the protected source", ops: [{ type: "setVolume", clipId: "score", volume: 0 }] };
page.on("pageerror", error => errors.push(error.message));
await page.route("**/api/assistant/config", route => route.fulfill({ json: { provider: "River", model: "controlled-browser-fixture", configured: true } }));
await page.route("**/api/assistant/propose", async route => { requests.push(route.request().postDataJSON()); await route.fulfill({ json: proposal }); });

async function state() {
  return page.evaluate(async () => {
    const module = suffix => {
      const url = performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname.endsWith(suffix))?.name;
      if (!url) throw new Error(`Missing application module ${suffix}`);
      return import(url);
    };
    const editor = (await module("/src/store.ts")).useEditorStore.getState();
    const production = (await module("/src/productionStore.ts")).useProductionStore.getState();
    return { document: production.document, volume: editor.timeline.clips.score?.volume, cursor: editor.history.cursor };
  });
}
async function saved() { await page.locator('[data-save-status="saved"]').waitFor(); }
async function record(name) {
  results.push({ name, state: await state() });
  await writeFile(path.join(out, "results.json"), JSON.stringify({ results, requests, errors }, null, 2));
  console.log(`PASS ${name}`);
}
async function openContext() {
  const button = page.getByRole("button", { name: "Edit brief and references", exact: true });
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
}
async function assistant() { await page.getByRole("button", { name: "Assistant", exact: true }).click(); await openContext(); }
async function request() {
  if (await page.getByRole("button", { name: "Edit brief and references", exact: true }).getAttribute("aria-expanded") === "true") await page.getByRole("button", { name: "Close context editor" }).click();
  await page.getByRole("textbox", { name: "What needs attention?" }).fill("Review the production and preserve all required source content.");
  await page.getByRole("button", { name: "Review production & propose edits", exact: true }).click();
  await page.getByLabel("Proposal actions", { exact: true }).waitFor();
  await page.locator(".agent-proposal-details > summary").click();
}

try {
  await page.goto(target.href);
  await page.getByRole("button", { name: "clip opening", exact: true }).waitFor();
  await saved(); await assistant();
  await page.getByRole("textbox", { name: "Production brief", exact: true }).fill("A production brief entered through the editor.");
  await page.getByText("Unsaved changes", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Explain & propose fixes", exact: true, includeHidden: true }).isDisabled(), true);
  await page.getByText("Add direction or requirements", { exact: true }).click();
  await page.getByRole("textbox", { name: "Reference style direction", exact: true }).fill("Patient pacing, with readable motion.");
  await page.getByRole("textbox", { name: "Continuity requirement", exact: true }).fill("Check continuity across the motion sequence.");
  await page.getByRole("spinbutton", { name: "Maximum production duration seconds", exact: true }).fill("8");
  await page.getByRole("button", { name: "Save production brief", exact: true }).click();
  await saved();
  assert.equal((await state()).document.styleReferences.length, 1);
  assert.equal((await state()).document.requirements.length, 2);
  await page.reload(); await saved(); await assistant();
  assert.equal(await page.getByRole("textbox", { name: "Production brief", exact: true }).inputValue(), "A production brief entered through the editor.");
  await record("brief, style and continuity authoring persists after reload");

  await page.getByRole("button", { name: "clip score", exact: true }).click();
  await openContext();
  await page.getByRole("button", { name: "Protect selected audio", exact: true }).click();
  assert.ok((await state()).document.requirements.some(entry => entry.kind === "preserve"));
  await page.getByText("Import or export source evidence", { exact: true }).click();
  await page.getByLabel("Import production context", { exact: true }).setInputFiles({ name: "production.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await page.getByText("Retain the sound bed", { exact: true }).waitFor();
  await saved();
  assert.deepEqual((await state()).document, document);
  assert.equal(await page.locator('[data-production-status="needs-review"]').count(), 1);
  await page.getByRole("button", { name: "Inspect request context", exact: true }).click();
  await page.getByLabel("Retrieved production evidence", { exact: true }).waitFor();
  assert.match(await page.getByLabel("Retrieved production evidence", { exact: true }).innerText(), /sound-note/);
  assert.match(await page.getByLabel("Retrieved production evidence", { exact: true }).innerText(), /opening-note/);
  await record("source range protection and authored production evidence import");

  const before = await state();
  await request();
  await page.getByLabel("Production requirement preview", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Apply 1 proposed edit", exact: true, includeHidden: true }).isDisabled(), true);
  assert.equal((await state()).volume, before.volume);
  const pack = JSON.parse(requests.at(-1).context);
  assert.equal(pack.kind, "production-context");
  assert.deepEqual(pack.requirements, document.requirements);
  assert.ok(pack.evidence.some(entry => entry.fact.id === "sound-note"));
  assert.ok(pack.evidence.some(entry => entry.fact.id === "opening-note"));
  assert.ok(pack.checks.some(entry => entry.status === "needs-review"));
  await page.screenshot({ path: path.join(out, "blocked-proposal.png") });
  await record("actual bounded request retains constraints and unsafe Apply is blocked");

  proposal = { summary: "Controlled response: lower gain while keeping the sound present", ops: [{ type: "setVolume", clipId: "score", volume: 0.5 }] };
  await request();
  const apply = page.getByRole("button", { name: "Apply 1 proposed edit", exact: true, includeHidden: true });
  await apply.waitFor(); assert.equal(await apply.isEnabled(), true);
  await page.getByRole("button", { name: "clip opening", exact: true }).click();
  await page.getByRole("button", { name: "clip score", exact: true }).click();
  assert.equal(await apply.isDisabled(), true);
  await record("selection away and back invalidates the proposal");

  await request();
  await apply.waitFor(); assert.equal(await apply.isEnabled(), true);
  await openContext();
  await page.getByRole("textbox", { name: "Production brief", exact: true }).fill(document.brief + " Retain the revised brief.");
  assert.equal(await apply.isDisabled(), true);
  await page.getByRole("button", { name: "Save production brief", exact: true }).click();
  await saved(); assert.equal(await apply.isDisabled(), true);
  await record("draft and saved brief changes invalidate stale application");

  await request();
  await apply.waitFor(); await apply.click();
  assert.equal((await state()).volume, 0.5);
  await page.getByRole("button", { name: "clip score", exact: true }).focus();
  await page.keyboard.press("Control+z");
  assert.equal((await state()).volume, before.volume);
  await saved();
  await openContext();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export production context", exact: true }).click();
  const download = await exported;
  await download.saveAs(path.join(out, "exported-production-context.json"));
  const exportedDocument = JSON.parse(await readFile(path.join(out, "exported-production-context.json"), "utf8"));
  assert.deepEqual(exportedDocument, (await state()).document);
  await page.getByLabel("Import production context", { exact: true }).setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ version: 1 })) });
  await page.getByRole("alert").filter({ hasText: "Production" }).waitFor();
  assert.deepEqual((await state()).document, exportedDocument);
  await record("valid proposal supports Undo, export and safe invalid-import refusal");

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("textbox", { name: "Production brief", exact: true }).scrollIntoViewIfNeeded();
  const bounds = await page.getByRole("region", { name: "Production context", exact: true }).boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1024);
  assert.equal(await page.getByRole("region", { name: "Production context", exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
  await page.screenshot({ path: path.join(out, "context-1024.png") });
  assert.deepEqual(errors, []);
  await record("laptop layout and no browser runtime errors");
} finally { await browser.close(); }
