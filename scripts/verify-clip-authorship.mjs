import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5187/";
assert.ok(["localhost", "127.0.0.1", "cutroom-editor.vercel.app"].includes(new URL(target).hostname), "Use the named Cutroom site or local preview");
const output = path.resolve(process.env.QA_OUTPUT_DIR ?? ".gstack/issue-review/authorship-local");
await mkdir(output, {recursive: true});
const browser = await chromium.launch({channel: "chrome", headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
await context.addInitScript(() => {
  if (localStorage.getItem("cutroom.authorId") === null) localStorage.setItem("cutroom.authorId", "QA main editor");
});
await context.route("**/api/assistant/propose", route => route.abort());
const page = await context.newPage(), results = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
async function saved() {await page.locator('[data-save-status="saved"]').waitFor();}
async function select(id) {
  await page.getByRole("button", {name: `clip ${id}`, exact: true}).click();
  await page.getByRole("tab", {name: "Clip", exact: true}).click();
}
async function author(id, expected) {
  await select(id);
  assert.equal((await page.locator(".inspector-author").innerText()).trim(), expected);
  await page.getByRole("button", {name: `clip ${id}`, exact: true}).locator(`[title="last edited by ${expected}"]`).waitFor();
}
async function versions() {await page.getByRole("button", {name: "Versions", exact: true}).click();}
async function checkout(branch) {
  await versions(); await page.getByRole("combobox", {name: "Current branch", exact: true}).selectOption(branch); await saved();
}
async function commit(message) {
  await versions(); await page.getByRole("textbox", {name: "Commit message", exact: true}).fill(message);
  await page.getByRole("button", {name: "Commit", exact: true}).click(); await saved();
}
async function start(value) {
  const field = page.getByRole("spinbutton", {name: "Clip start seconds", exact: true});
  await field.fill(value); await field.press("Enter");
}
async function project() {
  await saved();
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cutroom", 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("projects").objectStore("projects").get("current.demo-v1");
        request.onsuccess = () => resolve(JSON.parse(request.result)); request.onerror = () => reject(request.error);
      });
    } finally {db.close();}
  });
}
async function identity(name) {
  await saved(); await page.evaluate(name => localStorage.setItem("cutroom.authorId", name), name);
  await page.reload(); await saved();
}
function passed(name) {results.push({name}); console.log(`PASS ${name}`);}
try {
  await page.goto(new URL("?demo=1", target).href); await saved();
  await author("opening", "Editor A"); await author("score", "Demo");
  passed("sample clip authors are preserved");
  await select("opening"); await start("0.4"); await commit("QA main cut");
  await author("opening", "QA main editor");
  const mainHead = (await project()).repo.branches.main;
  await page.getByRole("textbox", {name: "New branch name", exact: true}).fill("qa-feature");
  await page.getByRole("button", {name: "Branch", exact: true}).click(); await checkout("qa-feature");
  await author("opening", "QA main editor");
  passed("checkout retains committed attribution");
  await identity("QA feature editor");
  await select("opening"); await start("0.6"); await commit("QA child commit");
  const featureHead = (await project()).repo.branches["qa-feature"];
  await checkout("main"); await author("opening", "QA main editor");
  await page.getByRole("combobox", {name: "Merge source", exact: true}).selectOption("qa-feature");
  await page.getByRole("button", {name: "Merge", exact: true}).click(); await saved();
  assert.equal((await project()).repo.branches.main, featureHead);
  await author("opening", "QA feature editor"); await author("score", "Demo");
  passed("fast-forward retains the feature editor without relabeling untouched clips");
  const beforeReload = await project(); await page.reload(); await saved();
  assert.deepEqual((await project()).repo, beforeReload.repo);
  await author("opening", "QA feature editor");
  passed("refresh derives the same author from saved snapshots");
  await versions(); await page.getByRole("button").filter({hasText: "QA main cut"}).click(); await saved();
  assert.equal((await project()).repo.detachedAt, mainHead); await author("opening", "QA main editor");
  await page.getByRole("button", {name: "back to main", exact: true}).click(); await saved();
  await author("opening", "QA feature editor");
  passed("detached inspection follows the viewed commit");
  await identity("QA working editor"); await select("opening"); await start("0.8");
  await author("opening", "QA working editor");
  await page.getByRole("button", {name: "Media", exact: true}).focus(); await page.keyboard.press("Control+z");
  await author("opening", "QA feature editor");
  await page.getByRole("button", {name: "Media", exact: true}).focus(); await page.keyboard.press("Control+Shift+z");
  await author("opening", "QA working editor");
  await page.getByRole("button", {name: "Media", exact: true}).focus(); await page.keyboard.press("Control+z");
  passed("working edits, undo and redo distinguish operation and committed authors");
  await versions(); await page.getByRole("combobox", {name: "Merge source", exact: true}).selectOption("alternate");
  await page.getByRole("button", {name: "Merge", exact: true}).click();
  await page.getByRole("button", {name: "Keep middle", exact: true}).click();
  await page.getByPlaceholder("merge commit message", {exact: true}).fill("QA attribution merge");
  await page.getByRole("button", {name: "Commit merge", exact: true}).click(); await saved();
  const merged = await project(), mergeCommit = merged.repo.commits[merged.repo.branches.main];
  assert.deepEqual(mergeCommit.parents, [featureHead, "c3"]);
  assert.equal(mergeCommit.author, "QA working editor");
  await author("opening", "QA feature editor"); await author("middle", "Editor A"); await author("score", "Demo");
  passed("two-parent merge preserves clip-specific provenance");
  await page.getByRole("button", {name: "Media", exact: true}).click();
  page.once("dialog", dialog => dialog.accept("attribution"));
  await page.getByRole("button", {name: "Tag motion.mp4", exact: true}).click(); await commit("QA metadata only");
  await page.reload(); await saved(); await author("opening", "QA feature editor"); await author("score", "Demo");
  await page.screenshot({path: path.join(output, "committed-authors-restored.png")});
  passed("metadata-only commits do not take authorship of unchanged clips");
  assert.deepEqual(errors, []);
} catch (error) {
  results.push({failed: error.message});
  await page.screenshot({path: path.join(output, "failure.png")});
  throw error;
} finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify({target, results, errors}, null, 2));
  await browser.close();
}
