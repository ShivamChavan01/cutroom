import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5186/";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname), "Use a local Vite server; assertions inspect actual stores");
const out = path.resolve(process.env.QA_OUTPUT_DIR ?? ".gstack/founder-demo/browser");
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: "chrome", headless: true});
const results = [];
const errors = [];
let activePage;
async function until(page, predicate, argument) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await page.evaluate(predicate, argument)) return;
    await page.waitForTimeout(50);
  }
  throw new Error("Browser condition timed out");
}
async function state(page) {
  return page.evaluate(async () => {
    const editor = (await import("/src/store.ts")).useEditorStore.getState();
    const vcs = (await import("/src/vcsStore.ts")).useVcsStore.getState();
    return {timeline: editor.timeline, repo: vcs.repo, pending: vcs.pending};
  });
}
async function ready(page, started = performance.now()) {
  await page.waitForSelector(".demo-guide");
  const demoInitializedMs = performance.now() - started;
  await until(page, () => [...document.querySelectorAll("[data-player-track] video")].some((v) => v.readyState >= 2 && v.videoWidth === 960 && !v.error));
  return {demoInitializedMs, playbackReadyMs: performance.now() - started};
}
async function saved(page) {
  await until(page, async () => (await import("/src/lib/persistence/persistenceStore.ts")).usePersistenceStore.getState().status === "saved");
}
async function capture(page, name) {
  await page.screenshot({path: path.join(out, name + ".png")});
}
try {
  for (const [width, height] of [[1440,900],[1366,768],[1280,800],[1024,768]]) {
    const context = await browser.newContext({viewport: {width, height}});
    context.on("page", page => page.on("pageerror", error => errors.push({width, message: error.message})));
    const personal = await context.newPage(); activePage = personal;
    const mediaRequests = [];
    personal.on("request", request => {if (/\/demo\/.*\.(mp4|wav)/.test(request.url())) mediaRequests.push(request.url());});
    const start = performance.now();
    await personal.goto(target);
    await personal.waitForSelector(".media-empty");
    const pageReadyMs = performance.now() - start;
    assert.equal(mediaRequests.length, 0, "Personal startup must not request demo media");
    assert.match(await personal.locator("footer").innerText(), /nothing to verify/);
    await personal.getByRole("button", {name: "Issues", exact: true}).click();
    assert.match(await personal.locator('[aria-label="diagnostics"]').first().innerText(), /No clips to verify/);
    await personal.getByRole("button", {name: "Media", exact: true}).click();
    await capture(personal, `fresh-${width}`);
    const popup = context.waitForEvent("page");
    const demoStart = performance.now();
    await personal.locator(".demo-start").click();
    const demo = await popup; activePage = demo;
    const demoTimings = await ready(demo, demoStart);
    const mediaResources = await demo.evaluate(() => performance.getEntriesByType("resource").filter(entry => /\/demo\/.*\.(mp4|wav)/.test(entry.name)).map(entry => ({name: new URL(entry.name).pathname, durationMs: entry.duration, transferSize: entry.transferSize})));
    const init = await state(demo);
    assert.equal(Object.keys(init.timeline.clips).length, 4);
    assert.equal(Object.keys(init.repo.commits).length, 4);
    assert.deepEqual(Object.keys(init.repo.branches), ["main", "alternate"]);
    // Upload a personal clip while the separate sample tab is open.
    await personal.locator('header input[type="file"]').first().setInputFiles(path.resolve("apps/web/public/demo/motion.mp4"));
    await until(personal, async () => Object.keys((await import("/src/store.ts")).useEditorStore.getState().timeline.clips).length === 1);
    await saved(personal);
    const personalBefore = await state(personal);
    const firstVideo = demo.locator('[data-player-track="v1"] video').first();
    const framesBefore = await firstVideo.evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames);
    await demo.getByRole("button", {name: "play", exact: true}).click();
    await until(demo, () => [...document.querySelectorAll('[data-player-track="v1"] video')].some(v => !v.paused && v.currentTime > .5 && v.getVideoPlaybackQuality().totalVideoFrames > 3));
    await demo.getByRole("button", {name: "pause", exact: true}).click();
    const decodedFrames = await firstVideo.evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames);
    assert.ok(decodedFrames > framesBefore, "Must decode real frames while playing");
    const seekMeasurements = [];
    for (const position of [3400, 5300, 400]) {
      const seekStart = performance.now();
      await demo.evaluate(async ms => (await import("/src/store.ts")).useEditorStore.getState().setPlayhead(ms), position);
      const expected = position === 3400 ? 2.4 : position === 5300 ? 4.3 : .5;
      await until(demo, expectedTime => [...document.querySelectorAll('[data-player-track="v1"] video')].some(v => getComputedStyle(v).display !== "none" && v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - expectedTime) < .15), expected);
      const times = await demo.locator('[data-player-track="v1"] video').evaluateAll(videos => videos.filter(v => getComputedStyle(v).display !== "none").map(v => v.currentTime));
      assert.ok(times.some(time => Math.abs(time - expected) < .15), `Expected source time ${expected}, received ${times}`);
      seekMeasurements.push({position, ms: performance.now() - seekStart});
    }
    await until(demo, () => document.querySelectorAll('[data-waveform-state="ready"]').length >= 4);
    await demo.getByRole("button", {name: "Fit timeline", exact: true}).click();
    await capture(demo, `sample-${width}`);
    assert.ok(await demo.locator(".editorial-timeline").evaluate(el => el.getBoundingClientRect().height) > 210);
    assert.equal(await demo.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "Desktop must not overflow horizontally");
    // Keyboard access and panel resizing use the real controls.
    const separator = demo.getByRole("separator").first();
    await separator.focus(); await demo.keyboard.press("ArrowRight");
    assert.equal(await separator.evaluate(el => document.activeElement === el), true);
    const box = await separator.boundingBox(); assert.ok(box);
    await demo.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await demo.mouse.down(); await demo.mouse.move(box.x + 20, box.y + box.height / 2, {steps: 5}); await demo.mouse.up();
    await demo.getByRole("button", {name: "See two versions", exact: true}).click();
    await demo.getByRole("combobox", {name: "Current branch", exact: true}).selectOption("alternate");
    assert.equal((await state(demo)).timeline.clips.ending.start, 4000);
    await demo.getByRole("combobox", {name: "Current branch", exact: true}).selectOption("main");
    await demo.getByRole("tab", {name: "Graph", exact: true}).click();
    await demo.locator('[aria-label="Commit graph"]').waitFor();
    await capture(demo, `graph-${width}`);
    await demo.getByRole("tab", {name: "History", exact: true}).click();
    await demo.getByRole("button", {name: "Compare edits", exact: true}).click();
    assert.ok((await demo.getByRole("tab", {name: "Diff", exact: true}).getAttribute("data-state")) === "active");
    await capture(demo, `comparison-${width}`);
    await demo.getByRole("button", {name: "Merge versions", exact: true}).click();
    const pending = (await state(demo)).pending;
    assert.equal(pending.result.clean, false);
    assert.deepEqual(pending.result.conflicts.map(c => c.kind), ["overlap"]);
    assert.equal(pending.result.conflicts[0].overlapStart, 4000);
    assert.equal(pending.result.conflicts[0].overlapEnd, 5000);
    assert.equal(await demo.getByRole("button", {name: "Commit merge", exact: true}).isDisabled(), true);
    await capture(demo, `conflict-${width}`);
    await demo.getByRole("button", {name: "Keep middle", exact: true}).click();
    assert.equal((await state(demo)).pending.result.clean, true);
    await demo.getByPlaceholder("merge commit message", {exact: true}).fill("Resolve timing conflict deliberately");
    await demo.getByRole("button", {name: "Commit merge", exact: true}).click();
    const after = await state(demo);
    const merge = after.repo.commits[after.repo.branches.main];
    assert.deepEqual(merge.parents, ["c2", "c3"]);
    assert.equal(after.timeline.clips.ending, undefined);
    assert.equal(after.timeline.clips.middle.start, 3000, "Resolution must not silently retime the kept clip");
    await demo.getByRole("button", {name: "Inspect findings", exact: true}).click();
    const finding = demo.locator('[aria-label="diagnostics"]').first().getByRole("button").filter({hasText: "gap"});
    await finding.click();
    assert.match(await finding.innerText(), /1200ms/);
    await capture(demo, `verification-${width}`);
    await saved(demo);
    await demo.reload(); await ready(demo);
    assert.deepEqual((await state(demo)).timeline, after.timeline);
    assert.deepEqual((await state(demo)).repo, after.repo);
    await demo.locator("header").getByRole("button", {name: "Export timeline", exact: true}).click();
    assert.match(await demo.getByRole("menu").innerText(), /Rendered MP4 export is not available/);
    assert.equal(await demo.getByRole("menuitem").count(), 4);
    await demo.keyboard.press("Escape");
    // Upload identical bytes in both workspaces, then remove the demo copy.
    // This exercises the same upload asset ID in two distinct OPFS directories.
    await demo.locator('header input[type="file"]').first().setInputFiles(path.resolve("apps/web/public/demo/motion.mp4"));
    const personalAssetId = Object.keys(personalBefore.timeline.assets)[0];
    await until(demo, async id => (await import("/src/store.ts")).useEditorStore.getState().timeline.assets[id] !== undefined, personalAssetId);
    await saved(demo);
    // Reset cancellation preserves the merged project; accepted reset affects only demo.
    demo.once("dialog", dialog => dialog.dismiss());
    await demo.getByRole("button", {name: "Reset sample", exact: true}).click();
    assert.deepEqual((await state(demo)).repo, after.repo);
    demo.once("dialog", dialog => dialog.accept());
    await demo.getByRole("button", {name: "Reset sample", exact: true}).click();
    await until(demo, async () => Object.keys((await import("/src/vcsStore.ts")).useVcsStore.getState().repo.commits).length === 4);
    await saved(demo);
    assert.deepEqual((await state(personal)).timeline, personalBefore.timeline);
    assert.deepEqual((await state(personal)).repo, personalBefore.repo);
    assert.equal(await demo.evaluate(async id => (await import("/src/lib/media/opfs.ts")).deleteMedia(id), personalAssetId), true);
    // Explicit personal link restores the saved personal project in a third tab.
    const personalPopup = context.waitForEvent("page");
    await demo.getByRole("link", {name: "Personal workspace ↗", exact: true}).click();
    const returned = await personalPopup;
    await until(returned, async () => (await import("/src/lib/persistence/persistenceStore.ts")).usePersistenceStore.getState().hydrated);
    assert.deepEqual((await state(returned)).timeline, personalBefore.timeline);
    await until(returned, () => [...document.querySelectorAll("[data-player-track] video")].some(v => v.readyState >= 2 && v.videoWidth > 0));
    await returned.close();
    if (width === 1440) {
      await demo.getByRole("button", {name: "See two versions", exact: true}).click();
      await demo.getByRole("button", {name: "Compare edits", exact: true}).click();
      await demo.getByRole("button", {name: "Merge versions", exact: true}).click();
      await demo.getByText("Pending merges are not saved.", {exact: false}).waitFor();
      await demo.reload(); await ready(demo);
      assert.equal((await state(demo)).pending, null);
      assert.equal(Object.keys((await state(demo)).repo.commits).length, 4);
      // Skipping the guide leaves the editor usable and can be reversed.
      await demo.getByRole("button", {name: "Skip guide", exact: true}).click();
      await demo.getByRole("button", {name: "Show walkthrough", exact: true}).click();
    }
    results.push({width, height, pageReadyMs, ...demoTimings, mediaResources, decodedFrames, seekMeasurements, passed: true});
    await context.close();
    console.log(`PASS ${width}×${height}: decoded playback, merge, verification, refresh, personal project isolation`);
  }
  // Only HTTP availability/error responses are fixtures. Timeline, proposal parser,
  // reducer, preview, apply and undo remain the real implementation. No paid API calls.
  const aiContext = await browser.newContext({viewport: {width: 1366, height: 768}});
  const ai = await aiContext.newPage(); activePage = ai;
  ai.on("pageerror", error => errors.push({scenario: "assistant", message: error.message}));
  let configMode = "available";
  let responseMode = 401;
  await ai.route("**/api/assistant/config", async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (configMode === "error") return route.fulfill({status: 503, json: {error: "unavailable"}});
    await route.fulfill({json: {provider: "River", model: "UI fixture (not a live request)", configured: configMode !== "unconfigured", accessRequired: true}});
  });
  await ai.route("**/api/assistant/propose", async route => {
    await new Promise(resolve => setTimeout(resolve, 350));
    if (responseMode !== 200) return route.fulfill({status: responseMode, json: {error: responseMode === 401 ? "Enter a valid assistant access code." : responseMode === 429 ? "River rate or quota limit reached. Check your account or retry later." : "River request failed (HTTP 500). Check the configured model and account access."}});
    await route.fulfill({json: {summary: "Browser test fixture: review this volume edit before applying.", ops: [{type: "setVolume", clipId: "score", volume: .4}]}});
  });
  await ai.goto(new URL("?demo=1", target).href); await ready(ai);
  await ai.getByRole("button", {name: "Assistant", exact: true}).click();
  await ai.getByText("Checking assistant availability…", {exact: true}).waitFor();
  await ai.getByText(/River assistant available/).waitFor();
  const request = ai.getByRole("button", {name: "Explain & propose fixes", exact: true});
  assert.equal(await request.isDisabled(), true);
  assert.match(await ai.locator(".assistant-availability").innerText(), /code required/);
  await capture(ai, "assistant-access-required");
  await ai.getByLabel("Assistant access code", {exact: true}).fill("browser-fixture-only");
  for (const status of [401, 429, 500, 200]) {
    responseMode = status;
    await request.click();
    await ai.getByText("Request in progress.", {exact: false}).waitFor();
    if (status !== 200) {
      await ai.locator('[role="alert"]').waitFor();
      assert.match(await ai.locator('[role="alert"]').innerText(), status === 401 ? /valid assistant access code/ : status === 429 ? /rate or quota/ : /HTTP 500/);
    } else {
      await ai.getByText("Proposal ready for review. No edits have been applied.", {exact: true}).waitFor();
      assert.equal((await state(ai)).timeline.clips.score.volume, .65);
      await ai.getByRole("button", {name: "Apply 1 proposed edit", exact: true}).click();
      assert.equal((await state(ai)).timeline.clips.score.volume, .4);
      await ai.keyboard.press("Control+z");
      assert.equal((await state(ai)).timeline.clips.score.volume, .65);
    }
    await capture(ai, `assistant-${status}`);
  }
  for (const mode of ["unconfigured", "error"]) {
    configMode = mode;
    await ai.getByRole("button", {name: "Media", exact: true}).click();
    await ai.getByRole("button", {name: "Assistant", exact: true}).click();
    await ai.getByText(/Assistant unavailable/).waitFor();
    assert.equal(await request.isDisabled(), true);
    await capture(ai, `assistant-${mode}`);
  }
  await aiContext.close();
  const mobileContext = await browser.newContext({viewport: {width: 390, height: 844}});
  const mobile = await mobileContext.newPage(); activePage = mobile;
  await mobile.goto(target); await mobile.waitForSelector(".mobile-notice", {state: "visible"});
  await capture(mobile, "mobile-limitation");
  results.push({mobile: "Desktop editing notice shown; full mobile editing is not supported", assistant: "HTTP state fixtures; no live provider request", errors});
  assert.deepEqual(errors, []);
  await mobileContext.close();
  console.log("PASS assistant state fixtures, preview-before-apply, undo, and mobile limitation");
} catch (error) {
  if (activePage && !activePage.isClosed()) await capture(activePage, "failure");
  results.push({failed: String(error), errors});
  throw error;
} finally {
  await writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
