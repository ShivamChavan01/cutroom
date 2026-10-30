import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5187/";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname));
const output = process.env.QA_OUTPUT_DIR ?? ".gstack/founder-demo/production-preview";
await mkdir(output, {recursive: true});
const browser = await chromium.launch({channel: "chrome", headless: true});
const results = [];
const errors = [];
async function decoded(page, sourceTime) {
  await page.waitForFunction(expected => [...document.querySelectorAll('[data-player-track="v1"] video')].some(v => getComputedStyle(v).display !== "none" && v.readyState >= 2 && v.videoWidth === 960 && !v.seeking && !v.error && (expected === null || Math.abs(v.currentTime - expected) < .15)), sourceTime ?? null);
}
try {
  for (let run = 1; run <= 3; run++) {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
    context.on("page", page => page.on("pageerror", error => errors.push({run, message: error.message})));
    const page = await context.newPage();
    const started = performance.now();
    await page.goto(target);
    await page.locator(".demo-start").waitFor();
    const initialEditorMs = performance.now() - started;
    const personalMediaRequests = await page.evaluate(() => performance.getEntriesByType("resource").filter(r => /\/demo\/.*\.(mp4|wav)/.test(r.name)).length);
    assert.equal(personalMediaRequests, 0);
    const popup = context.waitForEvent("page");
    const demoStarted = performance.now();
    await page.locator(".demo-start").click();
    const demo = await popup;
    await demo.locator(".demo-guide").waitFor();
    const demoInitializedMs = performance.now() - demoStarted;
    await decoded(demo);
    const playbackReadyMs = performance.now() - demoStarted;
    await demo.getByRole("button", {name: "play", exact: true}).click();
    await demo.waitForFunction(() => [...document.querySelectorAll('[data-player-track="v1"] video')].some(v => !v.paused && v.currentTime > .5 && v.getVideoPlaybackQuality().totalVideoFrames > 3));
    await demo.getByRole("button", {name: "pause", exact: true}).click();
    const seekResults = [];
    for (const [button, source] of [["next cut", 2], ["next cut", 4], ["previous cut", 2]]) {
      const seeking = performance.now();
      await demo.getByRole("button", {name: button, exact: true}).click();
      await decoded(demo, source);
      seekResults.push({action: button, sourceSeconds: source, responseMs: performance.now() - seeking});
    }
    const mediaResources = await demo.evaluate(() => performance.getEntriesByType("resource").filter(r => /\/demo\/.*\.(mp4|wav)/.test(r.name)).map(r => ({name: new URL(r.name).pathname, durationMs: r.duration, transferSize: r.transferSize})));
    if (run === 1) {
      await demo.getByRole("button", {name: "Fit timeline", exact: true}).click();
      await demo.screenshot({path: path.join(output, "sample-built.png")});
      await demo.getByRole("button", {name: "See two versions", exact: true}).click();
      await demo.getByRole("button", {name: "Compare edits", exact: true}).click();
      await demo.getByRole("button", {name: "Merge versions", exact: true}).click();
      await demo.getByRole("button", {name: "Keep middle", exact: true}).waitFor();
      await demo.screenshot({path: path.join(output, "conflict-built.png")});
      await demo.getByRole("button", {name: "Keep middle", exact: true}).click();
      await demo.getByPlaceholder("merge commit message", {exact: true}).fill("Production bundle smoke test");
      await demo.getByRole("button", {name: "Commit merge", exact: true}).click();
      await demo.getByRole("button", {name: "Inspect findings", exact: true}).click();
      await demo.getByRole("button", {name: /\[gap\].*1200ms/}).first().waitFor();
      await demo.waitForFunction(() => /\bsaved\b/.test(document.querySelector("footer")?.innerText ?? ""));
      await demo.reload(); await decoded(demo);
      const saved = await demo.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {const request = indexedDB.open("cutroom", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
        try {return await new Promise((resolve, reject) => {const request = db.transaction("projects", "readonly").objectStore("projects").get("current.demo-v1"); request.onsuccess = () => resolve(JSON.parse(request.result)); request.onerror = () => reject(request.error);});}
        finally {db.close();}
      });
      assert.deepEqual(saved.repo.commits[saved.repo.branches.main].parents, ["c2", "c3"]);
      assert.equal(saved.history.base.clips.ending, undefined);
      assert.match(await demo.locator(".demo-guide").innerText(), /Review the combined cut/);
    }
    results.push({run, initialEditorMs, demoInitializedMs, playbackReadyMs, mediaResources, seekResults});
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({browser: await browser.version(), results, errors}, null, 2));
} finally {
  await writeFile(path.join(output, "measurements.json"), JSON.stringify({results, errors}, null, 2));
  await browser.close();
}
