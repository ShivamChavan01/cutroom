import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = process.env.EDITOR_URL ?? "https://cutroom-editor.vercel.app/";
assert.ok(["localhost", "127.0.0.1", "cutroom-editor.vercel.app"].includes(new URL(target).hostname), "Use an isolated local production preview");
const out = path.resolve(process.env.QA_OUTPUT_DIR ?? ".gstack/adversarial-qa/production-issues");
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: "chrome", headless: true});
const page = await browser.newPage({viewport: {width: 1366, height: 768}});
const errors = [], results = [];
page.on("pageerror", error => errors.push(error.message));
async function saved() {await page.locator('[data-save-status="saved"]').waitFor();}
async function stored() {
  await saved();
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {const r = indexedDB.open("cutroom", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
    try {return await new Promise((resolve, reject) => {const r = db.transaction("projects").objectStore("projects").get("current.demo-v1"); r.onsuccess = () => resolve(JSON.parse(r.result)); r.onerror = () => reject(r.error);});}
    finally {db.close();}
  });
}
async function decoded() {await page.waitForFunction(() => [...document.querySelectorAll('[data-player-track="v1"] video')].some(v => v.readyState >= 2 && v.videoWidth === 960 && !v.error));}
async function versions() {await page.getByRole("button", {name: "Versions", exact: true}).click();}
async function merge(source) {
  await versions();
  await page.getByRole("combobox", {name: "Merge source", exact: true}).selectOption(source);
  await page.getByRole("button", {name: "Merge", exact: true}).click();
}
async function commit(message) {
  await versions();
  await page.getByRole("textbox", {name: "Commit message", exact: true}).fill(message);
  await page.getByRole("button", {name: "Commit", exact: true}).click();
  await saved();
}
async function checkout(name) {
  await versions();
  await page.getByRole("combobox", {name: "Current branch", exact: true}).selectOption(name);
  await saved();
}
async function shortcut(key) {
  await page.getByRole("button", {name: "Media", exact: true}).focus();
  await page.keyboard.press(key);
  await saved();
}
async function blocked(source) {
  const before = await stored();
  const dialog = page.waitForEvent("dialog");
  const click = merge(source);
  const alert = await dialog;
  assert.match(alert.message(), /Commit your uncommitted changes/);
  await alert.accept(); await click;
  const after = await stored();
  assert.deepEqual(after.repo, before.repo);
  assert.deepEqual(after.history, before.history);
  assert.equal(after.pending, null);
}
try {
  await page.goto(new URL("?demo=1", target).href); await decoded();
  const initial = await stored();
  const tag = page.getByRole("button", {name: "Tag motion.mp4", exact: true});
  page.once("dialog", d => d.accept("qa-tag")); await tag.click();
  await shortcut("Control+z");
  assert.doesNotMatch(await tag.innerText(), /qa-tag/);
  assert.equal(await page.getByRole("spinbutton", {name: "In point seconds", exact: true}).inputValue(), "0.1");
  await shortcut("Control+Shift+z"); assert.match(await tag.innerText(), /qa-tag/);
  await blocked("alternate");
  await page.reload(); await decoded(); await blocked("alternate");
  await commit("Tag sample");
  const tagged = await stored();
  await checkout("alternate"); await checkout("main");
  const returned = await stored();
  assert.deepEqual(returned.history.base.assets, tagged.repo.commits[tagged.repo.branches.main].timeline.assets);
  results.push("#5 tags undo/redo, commit, refresh and branch snapshots; #3 dirty merge rejected before and after refresh");

  await page.getByRole("button", {name: "clip opening", exact: true}).click();
  const start = page.getByRole("spinbutton", {name: "Clip start seconds", exact: true});
  for (const [draft, method, message] of [["-5", "Enter", /negative/], ["-5", "Tab", /negative/], ["", "Tab", /Enter a number/], ["1e20", "Enter", /range|safe|large|integer/i]]) {
    await start.fill(draft); await start.press(method);
    assert.equal(await start.inputValue(), "0");
    assert.equal(await start.getAttribute("aria-invalid"), "true");
    const id = await start.getAttribute("aria-describedby");
    assert.ok(id);
    assert.match(await page.locator(`[id="${id}"]`).innerText(), message);
  }
  await page.setViewportSize({width: 1024, height: 768});
  await page.screenshot({path: path.join(out, "numeric-validation-1024.png")});
  await page.setViewportSize({width: 1366, height: 768});
  const scale = page.getByRole("spinbutton", {name: "Scale X %", exact: true});
  await scale.fill("3000"); await scale.press("Enter");
  assert.equal(await scale.inputValue(), "100"); assert.equal(await scale.getAttribute("aria-invalid"), "true");
  const position = page.getByRole("spinbutton", {name: "Position X", exact: true});
  await position.fill("-10"); await position.press("Enter");
  assert.equal(await position.inputValue(), "-10"); assert.equal(await position.getAttribute("aria-invalid"), "false");
  await shortcut("Control+z"); assert.equal(await position.inputValue(), "0");
  await start.fill("2"); await start.press("Escape"); assert.equal(await start.inputValue(), "0");
  await start.fill("0.5"); await start.press("Enter");
  await shortcut("Control+z"); assert.equal(await start.inputValue(), "0");
  await shortcut("Control+Shift+z"); assert.equal(await start.inputValue(), "0.5");
  await page.reload();
  await page.getByRole("button", {name: "clip opening", exact: true}).click();
  await start.waitFor(); assert.equal(await start.inputValue(), "0.5");
  await page.getByRole("button", {name: "next cut", exact: true}).click(); await decoded();
  await shortcut("Control+z"); assert.equal(await start.inputValue(), "0");
  results.push("#2 rejected drafts roll back with associated inline errors; valid edit undo/redo and refresh");

  await merge("alternate");
  await page.getByRole("button", {name: "Keep middle", exact: true}).click();
  await page.getByPlaceholder("merge commit message", {exact: true}).fill("Reviewed sample merge");
  await page.getByRole("button", {name: "Commit merge", exact: true}).click();
  const merged = await stored();
  assert.deepEqual(merged.repo.commits[merged.repo.branches.main].parents, [tagged.repo.branches.main, "c3"]);
  await merge("alternate");
  await page.getByRole("status").filter({hasText: "Already up to date"}).waitFor();
  assert.deepEqual((await stored()).repo, merged.repo);
  assert.equal((await stored()).pending, null);
  await page.reload(); await decoded(); await merge("alternate");
  assert.deepEqual((await stored()).repo, merged.repo);
  results.push("#4 repeated merge is a no-op, including after reload; genuine divergent merge still commits two parents");

  await page.getByRole("textbox", {name: "New branch name", exact: true}).fill("ahead");
  await page.getByRole("button", {name: "Branch", exact: true}).click(); await checkout("ahead");
  await page.locator('header input[type="file"]').first().setInputFiles(path.resolve(process.env.QA_VIDEO ?? ".gstack/adversarial-qa/media/long.mp4"));
  await page.getByRole("button", {name: "Media", exact: true}).click();
  await page.getByRole("button", {name: "Tag long.mp4", exact: true}).waitFor();
  await commit("Add branch-only source");
  const ahead = await stored();
  await checkout("main"); await page.reload(); await decoded();
  await page.getByRole("button", {name: "clip opening", exact: true}).click();
  await start.fill("0.25"); await start.press("Enter");
  await blocked("ahead"); await shortcut("Control+z");
  await merge("ahead");
  await page.getByRole("status").filter({hasText: "Fast-forwarded"}).waitFor();
  const forwarded = await stored();
  assert.equal(forwarded.repo.branches.main, ahead.repo.branches.ahead);
  assert.deepEqual(forwarded.repo.commits, ahead.repo.commits);
  assert.equal(forwarded.pending, null);
  const snapshot = ahead.repo.commits[ahead.repo.branches.ahead].timeline;
  assert.deepEqual(forwarded.history.base, snapshot);
  const source = Object.values(snapshot.assets).find(a => a.name === "long.mp4");
  assert.ok(source);
  const clip = Object.values(snapshot.clips).find(c => c.assetId === source.id);
  assert.ok(clip);
  const precedingCuts = new Set(Object.values(snapshot.clips).map(c => c.start).filter(t => t > 0 && t <= clip.start));
  for (let remaining = precedingCuts.size; remaining > 0; remaining--) {
    await page.getByRole("button", {name: "next cut", exact: true}).click();
  }
  await page.getByRole("button", {name: `clip ${clip.id}`, exact: true}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-player-track="v1"] video')].some(v => v.readyState >= 2 && v.duration > 19 && !v.error));
  await page.getByRole("button", {name: "play", exact: true}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-player-track="v1"] video')].some(v => v.duration > 19 && !v.paused && v.getVideoPlaybackQuality().totalVideoFrames > 3));
  await page.getByRole("button", {name: "pause", exact: true}).click();
  await page.screenshot({path: path.join(out, "fast-forward-restored-media.png")});
  await page.reload(); await decoded();
  assert.deepEqual((await stored()).repo, forwarded.repo);
  results.push("#1 ancestry fast-forward preserves commit graph, restores branch-only OPFS video, decodes and plays, survives refresh; dirty fast-forward blocked");
  assert.equal(initial.version, 2);
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, "results.json"), JSON.stringify({results, errors}, null, 2));
  console.log(results.map(result => `PASS ${result}`).join("\n"));
} catch (error) {
  await page.screenshot({path: path.join(out, "failure.png")});
  await writeFile(path.join(out, "failure.json"), JSON.stringify({message: error.message, errors, results}, null, 2));
  throw error;
} finally {await browser.close();}
