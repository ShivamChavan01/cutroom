import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5191";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname), "Use a local development server and disposable browser context");
const out = path.resolve(process.env.QA_OUTPUT_DIR ?? ".gstack/gain-suggestions");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const errors = [], results = [];
page.on("pageerror", error => errors.push(error.message));

async function editor(action, argument) {
  return page.evaluate(async ({ action, argument }) => {
    const url = performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname === "/src/store.ts")?.name;
    if (!url) throw new Error("This check needs the actual Vite development module graph");
    const store = (await import(url)).useEditorStore;
    if (action === "inspect") {
      const state = store.getState();
      return { volumes: Object.fromEntries(Object.values(state.timeline.clips).map(clip => [clip.id, clip.volume])),
        cursor: state.history.cursor, decisions: state.gainSuggestions.decisions.length,
        gesture: state.gainSuggestions.gesture !== null, feedback: state.gainSuggestions.feedback.map(event => event.kind) };
    }
    if (action === "undo") store.getState().undo();
    if (action === "redo") store.getState().redo();
    if (action === "select") store.getState().selectClip(argument);
  }, { action, argument });
}

async function select(id) {
  await page.getByRole("button", { name: `clip ${id}`, exact: true }).click();
  const properties = page.getByRole("button", { name: "Properties", exact: true });
  if (await properties.getAttribute("aria-expanded") === "false") await properties.click();
  await page.getByRole("slider", { name: "Clip volume", exact: true }).waitFor();
}

async function pointerGain(id, value) {
  await select(id);
  const slider = page.getByRole("slider", { name: "Clip volume", exact: true });
  await slider.scrollIntoViewIfNeeded();
  const bounds = await slider.boundingBox();
  assert.ok(bounds);
  const x = amount => bounds.x + 8 + (bounds.width - 16) * amount / 100;
  await page.mouse.move(x(100), bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(x(70), bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.move(x(value), bounds.y + bounds.height / 2, { steps: 6 });
  await page.mouse.move(x(value), bounds.y + 75);
  await page.mouse.up();
  assert.equal(await slider.inputValue(), String(value));
  assert.equal((await editor("inspect")).gesture, false, "Pointer release outside the slider finishes the gesture");
}

async function record(name) {
  const state = await editor("inspect");
  results.push({ name, state });
  await writeFile(path.join(out, "results.json"), JSON.stringify({ results, errors }, null, 2));
  console.log(`PASS ${name}`);
}

try {
  await page.goto(target);
  await page.getByRole("button", { name: "Add media", exact: true }).waitFor();
  await page.evaluate(async () => {
    const resource = suffix => {
      const url = performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname.endsWith(suffix))?.name;
      if (!url) throw new Error(`Missing application module ${suffix}`);
      return url;
    };
    const engine = await import(resource("/packages/engine/src/index.ts"));
    const editor = (await import(resource("/src/store.ts"))).useEditorStore;
    const vcs = (await import(resource("/src/vcsStore.ts"))).useVcsStore;
    const assets = await import(resource("/src/lib/assets.ts"));
    let timeline = engine.putAsset(engine.emptyTimeline("Gain suggestion browser check"), { id: "music", kind: "audio", duration: 8000, name: "pulse.wav" });
    for (const [index, id] of ["one", "two", "three", "four", "five", "six"].entries()) {
      timeline = engine.applyOp(timeline, { type: "addClip", clip: engine.makeClip({ id, trackId: "a1", assetId: "music", start: index * 1000, inPoint: index * 1000, duration: 1000, volume: 1 }) });
    }
    vcs.setState({ repo: null, pending: null, diffOverlay: null });
    editor.getState().loadTimeline(timeline);
    assets.registerAssetUrl("music", "/demo/pulse.wav");
    vcs.getState().ensureRepo();
  });

  await pointerGain("one", 30);
  assert.equal((await editor("inspect")).decisions, 1, "Pointer ticks count as one decision");
  await select("four");
  assert.equal(await page.getByRole("region", { name: "Suggested gain match" }).count(), 0);
  await record("pointer capture and weak-evidence abstention");

  await select("two");
  let slider = page.getByRole("slider", { name: "Clip volume", exact: true });
  await slider.press("Home");
  const beforeRepeat = (await editor("inspect")).decisions;
  for (let count = 0; count < 30; count += 1) await page.keyboard.down("ArrowRight");
  assert.equal((await editor("inspect")).decisions, beforeRepeat);
  await page.keyboard.up("ArrowRight");
  assert.equal(await slider.inputValue(), "30");
  assert.equal((await editor("inspect")).decisions, beforeRepeat + 1);
  await record("keyboard repeat counts as one completed decision");

  await select("three");
  slider = page.getByRole("slider", { name: "Clip volume", exact: true });
  await slider.focus();
  await page.keyboard.down("Home");
  await page.keyboard.up("Home");
  for (let count = 0; count < 30; count += 1) await page.keyboard.down("ArrowRight");
  await page.getByRole("checkbox", { name: "Suggest gain matches", exact: true }).focus();
  await page.keyboard.up("ArrowRight");
  assert.equal((await editor("inspect")).gesture, false);
  await select("four");
  const suggestion = page.getByRole("region", { name: "Suggested gain match", exact: true });
  await suggestion.waitFor();
  assert.match(await suggestion.innerText(), /last three gain edits/);
  assert.equal(await suggestion.getByRole("button", { name: "Apply gain match", exact: true }).count(), 0);
  assert.equal(await suggestion.evaluate(element => getComputedStyle(element).borderTopWidth), "1px");
  await record("blur completion produces a contextual offer");

  const beforePreview = await editor("inspect");
  await page.getByRole("button", { name: "Preview gain match", exact: true }).click();
  assert.equal((await editor("inspect")).volumes.four, 1);
  assert.equal((await editor("inspect")).cursor, beforePreview.cursor);
  await page.getByLabel("Gain match preview", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(out, "preview-1440.png") });
  await page.getByRole("button", { name: "Apply gain match", exact: true }).click();
  const applied = await editor("inspect");
  assert.equal(applied.volumes.four, 0.3);
  assert.equal(applied.cursor, beforePreview.cursor + 1);
  assert.equal(applied.decisions, beforePreview.decisions, "Accepted suggestions are not manual evidence");
  await page.getByText("Applied gain match. Undo reverses this edit.", { exact: true }).waitFor();
  await editor("undo");
  assert.equal((await editor("inspect")).volumes.four, 1);
  assert.equal(await suggestion.count(), 0, "Immediate Undo must not nag again");
  assert.ok((await editor("inspect")).feedback.includes("undone"));
  await record("preview, apply, single Undo and self-feedback exclusion");

  await select("five");
  await suggestion.waitFor();
  await page.getByRole("button", { name: "Dismiss gain suggestion", exact: true }).click();
  await select("six"); await select("five");
  assert.equal(await suggestion.count(), 0);
  await record("dismissal survives selection away and back");

  await select("six");
  await page.getByRole("button", { name: "Preview gain match", exact: true }).click();
  await page.getByRole("button", { name: "Lock track a1", exact: true }).click();
  assert.equal(await suggestion.count(), 0);
  await page.getByRole("button", { name: "Lock track a1", exact: true }).click();
  await suggestion.waitFor();
  assert.equal(await page.getByRole("button", { name: "Apply gain match", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Preview gain match", exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await suggestion.scrollIntoViewIfNeeded();
  const box = await suggestion.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 1024, "Suggestion remains inside the laptop viewport");
  await page.screenshot({ path: path.join(out, "preview-1024.png") });
  await record("lock invalidation and laptop layout");

  await page.getByRole("checkbox", { name: "Suggest gain matches", exact: true }).uncheck();
  assert.equal(await suggestion.count(), 0);
  assert.equal((await editor("inspect")).decisions, 0);
  await page.getByRole("checkbox", { name: "Suggest gain matches", exact: true }).check();
  assert.equal(await suggestion.count(), 0);
  await select("one");
  slider = page.getByRole("slider", { name: "Clip volume", exact: true });
  await slider.scrollIntoViewIfNeeded();
  const cancelledBounds = await slider.boundingBox();
  assert.ok(cancelledBounds);
  await page.mouse.move(cancelledBounds.x + cancelledBounds.width * 0.3, cancelledBounds.y + cancelledBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(cancelledBounds.x + cancelledBounds.width * 0.6, cancelledBounds.y + cancelledBounds.height / 2, { steps: 4 });
  await slider.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await slider.blur();
  assert.equal((await editor("inspect")).decisions, 0, "Cancelled gestures supply no evidence");
  assert.deepEqual(errors, [], "No browser runtime errors");
  await record("disable clears session evidence and pointer cancellation supplies none");
} finally {
  await browser.close();
}
