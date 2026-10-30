import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = process.env.EDITOR_URL ?? "https://cutroom-editor.vercel.app/";
assert.ok(["localhost", "127.0.0.1", "cutroom-editor.vercel.app"].includes(new URL(target).hostname), "Use an isolated local production preview");
const out = path.resolve(process.env.QA_OUTPUT_DIR ?? ".gstack/adversarial-qa/production-walkthrough");
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: "chrome", headless: true});
const errors = [], consoleErrors = [], httpErrors = [], results = [];
let activePage;
async function context(viewport) {
  const ctx = await browser.newContext({viewport});
  ctx.on("page", page => {
    page.on("response", response => {if (response.status() >= 400) httpErrors.push({url: response.url(), status: response.status()});});
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {if (message.type() === "error") consoleErrors.push(message.text());});
  });
  return ctx;
}
async function saved(page) {await page.locator('[data-save-status="saved"]').waitFor();}
async function decoded(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('[data-player-track="v1"] video')].some(v => v.readyState >= 2 && v.videoWidth === 960 && !v.error));
}
async function shot(page, name) {await page.screenshot({path: path.join(out, name + ".png")});}
async function stored(page, key = "current.demo-v1") {
  return page.evaluate(async key => {
    const db = await new Promise((resolve, reject) => {const r = indexedDB.open("cutroom", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
    try {return await new Promise((resolve, reject) => {const r = db.transaction("projects", "readonly").objectStore("projects").get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});}
    finally {db.close();}
  }, key);
}
async function seed(page, raw, key = "current.demo-v1") {
  await page.evaluate(async ({raw, key}) => {
    const db = await new Promise((resolve, reject) => {const r = indexedDB.open("cutroom", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
    try {await new Promise((resolve, reject) => {const tx = db.transaction("projects", "readwrite"); tx.objectStore("projects").put(raw, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);});}
    finally {db.close();}
  }, {raw, key});
}
async function startMerge(page) {
  await page.getByRole("button", {name: "See two versions", exact: true}).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", {name: "Compare edits", exact: true}).click();
  await page.getByRole("button", {name: "Merge versions", exact: true}).click();
  await page.getByRole("button", {name: "Keep middle", exact: true}).waitFor();
}
async function reset(page) {
  page.once("dialog", d => d.accept());
  await page.getByRole("button", {name: "Reset sample", exact: true}).click();
  await page.getByRole("button", {name: "See two versions", exact: true}).waitFor();
  await decoded(page);
}
try {
  for (const [width, height] of [[1920,1080], [1440,900], [1280,800], [1024,768]]) {
    const ctx = await context({width, height});
    const page = await ctx.newPage(); activePage = page;
    await page.goto(new URL("?demo=1", target).href);
    await decoded(page); await saved(page);
    assert.match(await page.locator(".demo-guide").innerText(), /Explore different edits without losing your work/);
    const initial = JSON.parse(await stored(page));
    assert.equal(initial.repo.currentBranch, "main");
    assert.deepEqual(Object.keys(initial.repo.branches), ["main", "alternate"]);
    assert.equal(Object.keys(initial.repo.commits).length, 4);
    await page.getByRole("button", {name: "play", exact: true}).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-player-track="v1"] video')].some(v => !v.paused && v.currentTime > .5 && v.getVideoPlaybackQuality().totalVideoFrames > 3));
    assert.notEqual(await page.getByLabel("timecode", {exact: true}).innerText(), "00:00:00:00");
    await page.getByRole("button", {name: "pause", exact: true}).click();
    await page.getByRole("button", {name: "Fit timeline", exact: true}).click();
    await shot(page, `intro-${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.getByRole("button", {name: "See two versions", exact: true}).click();
    await page.getByRole("combobox", {name: "Current branch", exact: true}).selectOption("alternate");
    assert.match(await page.locator(".demo-guide").innerText(), /viewing another cut/);
    await saved(page);
    assert.equal(JSON.parse(await stored(page)).history.base.clips.ending.start, 4000);
    await page.getByRole("combobox", {name: "Current branch", exact: true}).selectOption("main");
    await page.getByRole("tab", {name: "Graph", exact: true}).click();
    await page.locator('[aria-label="Commit graph"]').waitFor();
    await shot(page, `graph-${width}`);
    await page.getByRole("tab", {name: "History", exact: true}).click();
    await page.getByRole("button", {name: "Compare edits", exact: true}).click();
    await page.getByRole("tab", {name: "Diff", exact: true}).waitFor();
    await shot(page, `compare-${width}`);
    await page.getByRole("button", {name: "Merge versions", exact: true}).click();
    await saved(page);
    const pending = JSON.parse(await stored(page));
    assert.equal(pending.pending.sourceBranch, "alternate");
    assert.equal(pending.pending.targetBranch, "main");
    assert.equal(pending.pending.baseId, "c1");
    assert.deepEqual(pending.pending.resolutions, []);
    assert.equal(pending.pending.result, undefined, "Results must be replayed, not trusted from storage");
    await shot(page, `conflict-${width}`);
    assert.match(await page.locator(".merge-overlap").innerText(), /4.00s to 5.00s/);
    assert.match(await page.locator(".merge-overlap").innerText(), /Removes ending/);
    assert.equal(await page.getByRole("button", {name: "Commit merge", exact: true}).isDisabled(), true);
    // Before resolution, reload must reconstruct the actual conflict.
    await page.reload(); await decoded(page);
    await page.getByRole("button", {name: "Keep middle", exact: true}).waitFor();
    assert.match(await page.locator("footer").innerText(), /Merge pending.*1 unresolved/);
    await page.getByRole("button", {name: "Keep middle", exact: true}).click();
    await saved(page);
    const chosen = JSON.parse(await stored(page));
    assert.equal(chosen.pending.resolutions.length, 1);
    // After resolution, reload must preserve the choice and enable a merge commit.
    await page.reload(); await decoded(page);
    assert.match(await page.locator(".demo-guide").innerText(), /Your choice is recorded/);
    await page.getByPlaceholder("merge commit message", {exact: true}).fill("Reviewed timing choice");
    await page.getByRole("button", {name: "Commit merge", exact: true}).click();
    await saved(page);
    const committed = JSON.parse(await stored(page));
    assert.deepEqual(committed.repo.commits[committed.repo.branches.main].parents, ["c2", "c3"]);
    assert.equal(committed.history.base.clips.ending, undefined);
    assert.equal(committed.history.base.clips.middle.start, 3000);
    assert.equal(committed.pending, null);
    await page.getByRole("button", {name: "Inspect findings", exact: true}).click();
    const finding = page.locator('[aria-label="diagnostics"]').first().getByRole("button").filter({hasText: "gap of 1200ms"});
    assert.match(await finding.innerText(), /1.80s to 3.00s on video track V1/);
    assert.match(await finding.innerText(), /Keep the pause if deliberate/);
    await finding.click();
    assert.match(await page.getByLabel("timecode", {exact: true}).innerText(), /00:00:01:24/);
    await shot(page, `verification-${width}`);
    await page.reload(); await decoded(page);
    assert.deepEqual(JSON.parse(await stored(page)).repo, committed.repo);
    await page.getByRole("button", {name: "Skip guide", exact: true}).click();
    await page.getByRole("button", {name: "Show walkthrough", exact: true}).click();
    assert.match(await page.locator(".demo-guide").innerText(), /Review the combined cut/);
    // The normal timeline-only export remains explicit.
    await page.locator("header").getByRole("button", {name: "Export timeline", exact: true}).click();
    assert.match(await page.getByRole("menu").innerText(), /Rendered MP4 export is not available/);
    await page.keyboard.press("Escape");
    await reset(page); await saved(page);
    await startMerge(page); await saved(page);
    await page.getByRole("button", {name: "Cancel", exact: true}).click(); await saved(page);
    const cancelled = JSON.parse(await stored(page));
    assert.equal(cancelled.pending, null);
    assert.deepEqual(cancelled.repo, initial.repo);
    await reset(page);
    results.push({viewport: `${width}x${height}`, passed: ["decoded playback", "versions", "graph", "diff", "unresolved refresh", "resolved refresh", "merge commit", "gap timing", "committed refresh", "skip/reopen/reset", "cancel"]});
    await ctx.close();
    console.log(`PASS ${width}x${height} built editor and recovered merge`);
  }
  // Personal work is persisted in another project key and remains untouched.
  const isolated = await context({width: 1366, height: 768});
  const personal = await isolated.newPage(); activePage = personal;
  await personal.goto(target); await personal.locator(".demo-start").waitFor();
  await personal.locator('header input[type="file"]').first().setInputFiles(path.resolve("apps/web/public/demo/motion.mp4"));
  await personal.getByRole("tab", {name: "Project", exact: true}).click();
  await personal.getByRole("textbox", {name: "Project name", exact: true}).fill("Personal QA cut");
  await personal.getByRole("button", {name: "Save name", exact: true}).click(); await saved(personal);
  const original = await stored(personal, "current");
  const popup = isolated.waitForEvent("page");
  await personal.getByRole("link", {name: "Try demo project ↗", exact: true}).click();
  const demo = await popup; activePage = demo; await decoded(demo);
  await startMerge(demo); await saved(demo); await reset(demo); await saved(demo);
  assert.equal(await stored(demo, "current"), original);
  await personal.reload(); await decoded(personal);
  assert.equal(await stored(personal, "current"), original);
  assert.match(await personal.locator(".studio-topbar").innerText(), /Personal QA cut/);
  await shot(personal, "personal-preserved");
  await isolated.close();
  results.push({isolation: "Personal bytes and playable media preserved after demo merge/reset"});

  // A title conflict plus the real timing conflict proves partial recovery too.
  const partialCtx = await context({width: 1366, height: 768});
  const partial = await partialCtx.newPage(); activePage = partial;
  await partial.goto(new URL("?demo=1", target).href); await decoded(partial);
  const rename = async name => {
    await partial.getByRole("tab", {name: "Project", exact: true}).click();
    await partial.getByRole("textbox", {name: "Project name", exact: true}).fill(name);
    await partial.getByRole("button", {name: "Save name", exact: true}).click();
    await partial.getByRole("button", {name: "Versions", exact: true}).click();
    await partial.getByLabel("Commit message", {exact: true}).fill(name);
    await partial.getByRole("button", {name: "Commit", exact: true}).click();
  };
  await rename("Our title");
  await partial.getByLabel("Current branch", {exact: true}).selectOption("alternate");
  await rename("Their title");
  await partial.getByLabel("Current branch", {exact: true}).selectOption("main");
  await partial.getByLabel("Merge source", {exact: true}).selectOption("alternate");
  await partial.getByRole("button", {name: "Merge", exact: true}).click();
  await partial.getByRole("button", {name: "Keep ours", exact: true}).click(); await saved(partial);
  const partlyChosen = JSON.parse(await stored(partial));
  assert.equal(partlyChosen.pending.resolutions.length, 1);
  await partial.reload(); await decoded(partial);
  assert.equal(await partial.getByRole("button", {name: "Keep ours", exact: true}).count(), 0);
  await partial.getByRole("button", {name: "Keep middle", exact: true}).click(); await saved(partial);
  await partial.reload(); await decoded(partial);
  assert.equal(JSON.parse(await stored(partial)).pending.resolutions.length, 2);
  await partial.getByPlaceholder("merge commit message", {exact: true}).fill("Reviewed title and timing");
  await partial.getByRole("button", {name: "Commit merge", exact: true}).click(); await saved(partial);
  const combined = JSON.parse(await stored(partial));
  assert.deepEqual(combined.repo.commits[combined.repo.branches.main].parents, ["c4", "c5"]);
  assert.match(await partial.locator(".demo-guide").innerText(), /Review the combined cut/);
  await shot(partial, "partial-merge-restored");
  await partialCtx.close();
  results.push({partialMerge: "Two real conflicts, a saved title choice with overlap remaining, then saved overlap choice and two-parent commit"});

  // Invalid pending data must not prevent recovery of the valid saved graph.
  const recoveryCtx = await context({width: 1280, height: 800});
  const recovery = await recoveryCtx.newPage(); activePage = recovery;
  await recovery.goto(new URL("?demo=1", target).href); await decoded(recovery);
  await startMerge(recovery); await saved(recovery);
  const invalid = JSON.parse(await stored(recovery)); const safeRepo = invalid.repo;
  invalid.pending.baseId = "missing-base";
  await seed(recovery, JSON.stringify(invalid));
  await recovery.reload(); await decoded(recovery);
  await recovery.getByText(/Unfinished merge could not be restored/).waitFor();
  assert.deepEqual(JSON.parse(await stored(recovery)).repo, safeRepo);
  await shot(recovery, "invalid-merge-recovery");
  // Entirely corrupt projects keep their original text available for rescue.
  await seed(recovery, "not-json"); await recovery.reload();
  await recovery.getByText(/Stored project could not be loaded/).waitFor();
  assert.equal(await stored(recovery), "not-json");
  await shot(recovery, "corrupt-project-rescue");
  recovery.once("dialog", d => d.accept());
  await recovery.getByRole("button", {name: "Reset project", exact: true}).click();
  await decoded(recovery);
  await recovery.reload(); await decoded(recovery);
  await recoveryCtx.close();
  results.push({recovery: "Invalid pending merge and corrupt project rescue preserved saved data"});

  // True browser failure injection, with a healthy audio track arriving later.
  for (const failure of ["missing", "decode", "storage"]) {
    const ctx = await context({width: 1024, height: 768});
    const page = await ctx.newPage(); activePage = page;
    if (failure === "storage") await page.addInitScript(() => {Object.defineProperty(window, "indexedDB", {get() {throw new Error("QA denied storage");}});});
    else {
      await page.route("**/demo/motion.mp4", route => route.fulfill({status: failure === "missing" ? 404 : 200, contentType: "video/mp4", body: "unreadable-video"}));
      await page.route("**/demo/pulse.wav", async route => {await new Promise(resolve => setTimeout(resolve, 1000)); await route.continue();});
    }
    await page.goto(new URL("?demo=1", target).href); await page.locator(".demo-guide").waitFor();
    if (failure === "storage") {
      await decoded(page); assert.match(await page.locator("footer").innerText(), /storage unavailable/);
    } else {
      await page.waitForFunction(() => [...document.querySelectorAll("audio")].some(a => a.readyState >= 2));
      await page.getByRole("alert").filter({hasText: "Could not decode motion.mp4"}).waitFor();
    }
    await shot(page, `failure-${failure}`);
    await ctx.close();
  }
  results.push({failures: "Missing source, failed decode after audio readiness, storage unavailable"});

  // AI endpoint responses are deterministic fixtures. No paid model is called.
  const aiCtx = await context({width: 1366, height: 768});
  const ai = await aiCtx.newPage(); activePage = ai;
  let providerAvailable = true;
  await ai.route("**/api/assistant/config", route => route.fulfill({json: {provider: "River", model: "QA availability fixture", configured: providerAvailable, accessRequired: true}}));
  let status = 401;
  await ai.route("**/api/assistant/propose", route => route.fulfill({status, json: {error: status === 401 ? "Enter a valid assistant access code." : "River rate or quota limit reached. Check your account or retry later."}}));
  await ai.goto(new URL("?demo=1", target).href); await decoded(ai);
  await ai.getByRole("button", {name: "Assistant", exact: true}).click();
  await ai.getByLabel("Assistant access code", {exact: true}).waitFor();
  const request = ai.getByRole("button", {name: "Explain & propose fixes", exact: true});
  assert.equal(await request.isDisabled(), true);
  await ai.getByLabel("Assistant access code", {exact: true}).fill("QA fixture only");
  await request.click(); await ai.getByRole("alert").filter({hasText: "valid assistant access code"}).waitFor();
  status = 429; await request.click(); await ai.getByRole("alert").filter({hasText: "rate or quota"}).waitFor();
  providerAvailable = false;
  await ai.getByRole("button", {name: "Media", exact: true}).click();
  await ai.getByRole("button", {name: "Assistant", exact: true}).click();
  await ai.getByText(/Assistant unavailable: server configuration/).waitFor();
  assert.equal(await request.isDisabled(), true);
  await shot(ai, "assistant-unavailable"); await aiCtx.close();
  results.push({assistant: "Availability, unauthorized, rate error, unavailable fixtures; zero paid calls"});
  assert.deepEqual(errors, []);
  console.log("PASS personal isolation, merge/project recovery, decode/storage failures and AI fixtures");
} catch (error) {
  results.push({failure: String(error)});
  if (activePage && !activePage.isClosed()) await shot(activePage, "failure");
  throw error;
} finally {
  await writeFile(path.join(out, "results.json"), JSON.stringify({results, errors, consoleErrors, httpErrors}, null, 2));
  await browser.close();
}
