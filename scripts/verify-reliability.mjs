import assert from "node:assert/strict";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5187/";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname), "Use an isolated local production preview");
const output = path.resolve(process.env.QA_OUTPUT_DIR ?? ".gstack/reliability-fixes/browser");
await mkdir(output, {recursive: true});
const bytes = await readFile(process.env.TEST_VIDEO_A ?? "apps/web/public/demo/motion.mp4");
const input = {name: "qa-source.mp4", mimeType: "video/mp4", buffer: bytes};
const browser = await chromium.launch({channel: "chrome", headless: true});
const results = [], errors = [];
let activePage, activeCase;

async function saved(page) {await page.locator('[data-save-status="saved"]').waitFor();}
async function fresh({quotaFailure = false, width = 1440} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.route("**/api/assistant/propose", route => route.abort());
  if (quotaFailure) await context.addInitScript(() => {
    Object.defineProperty(navigator.storage, "getDirectory", {value: async () => {throw new DOMException("QA quota denied", "QuotaExceededError");}});
  });
  const page = await context.newPage(); activePage = page;
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(new URL("?demo=1", target).href);
  await page.getByRole("button", {name: "clip opening", exact: true}).waitFor();
  await saved(page);
  return {context, page};
}
async function project(page) {
  await saved(page);
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
async function mediaBytes(page, id) {
  return page.evaluate(async id => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("media.demo-v1");
    return (await (await directory.getFileHandle(id)).getFile()).size;
  }, id);
}
async function upload(page) {
  await page.locator('header input[type="file"]').first().setInputFiles(input);
}
async function commit(page, message) {
  await page.getByRole("button", {name: "Versions", exact: true}).click();
  await page.getByRole("textbox", {name: "Commit message", exact: true}).fill(message);
  await page.getByRole("button", {name: "Commit", exact: true}).click();
}
async function checkout(page, branch) {
  await page.getByRole("button", {name: "Versions", exact: true}).click();
  await page.getByRole("combobox", {name: "Current branch", exact: true}).selectOption(branch);
  await saved(page);
}
async function playSource(page, timeline, clip) {
  const cuts = new Set(Object.values(timeline.clips).map(item => item.start).filter(at => at > 0 && at <= clip.start));
  for (let remaining = cuts.size; remaining > 0; remaining--) await page.getByRole("button", {name: "next cut", exact: true}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-player-track="v1"] video')].some(video =>
    video.currentSrc.startsWith("blob:") && video.readyState >= 2 && video.videoWidth > 0 && !video.error));
  await page.getByRole("button", {name: "play", exact: true}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-player-track="v1"] video')].some(video =>
    video.currentSrc.startsWith("blob:") && !video.paused && video.getVideoPlaybackQuality().totalVideoFrames > 3 && !video.error));
  await page.getByRole("button", {name: "pause", exact: true}).click();
}
async function passed(detail) {results.push({name: activeCase, detail}); console.log(`PASS ${activeCase}`);}

try {
  activeCase = "#9 delayed older save cannot acknowledge a newer commit";
  {
    const {context, page} = await fresh();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      window.qaHoldNext = true;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (this.name === "projects" && window.qaHoldNext) {
          window.qaHoldNext = false; window.qaHeld = true;
          const hold = () => {if (!window.qaRelease) {const read = this.get("qa-keepalive"); read.onsuccess = hold;}};
          hold();
        }
        return request;
      };
    });
    const start = page.getByRole("spinbutton", {name: "Clip start seconds", exact: true});
    await start.fill("0.1"); await start.press("Enter"); await commit(page, "First snapshot");
    await page.waitForFunction(() => window.qaHeld === true);
    await start.fill("0.2"); await start.press("Enter"); await commit(page, "Second snapshot");
    await page.evaluate(() => {window.qaRelease = true;});
    const stored = await project(page);
    assert.equal(stored.repo.commits[stored.repo.branches.main].message, "Second snapshot");
    await page.reload(); await saved(page); await checkout(page, "main");
    const restored = await project(page);
    assert.deepEqual(restored.repo, stored.repo);
    assert.equal(restored.repo.commits[restored.repo.branches.main].timeline.clips.opening.start, 200);
    await page.screenshot({path: path.join(output, "latest-save-restored.png")});
    await passed({head: stored.repo.branches.main, survivedReload: true}); await context.close();
  }

  activeCase = "#6 source survives Delete, Undo, Redo, commit and refresh";
  {
    const {context, page} = await fresh(); await upload(page);
    await page.getByRole("button", {name: "Tag qa-source.mp4", exact: true}).waitFor();
    const imported = await project(page);
    const add = imported.history.log.at(-1).op; assert.equal(add.type, "addClip");
    const clip = add.clip;
    assert.equal(await mediaBytes(page, clip.assetId), bytes.length);
    await page.getByRole("button", {name: `clip ${clip.id}`, exact: true}).click();
    await page.keyboard.press("Delete");
    await page.getByRole("button", {name: "Media", exact: true}).focus();
    await page.keyboard.press("Control+z"); await page.keyboard.press("Control+Shift+z"); await page.keyboard.press("Control+z");
    assert.equal(await mediaBytes(page, clip.assetId), bytes.length);
    await commit(page, "Restored source"); const committed = await project(page);
    const timeline = committed.repo.commits[committed.repo.branches.main].timeline;
    assert.equal(timeline.clips[clip.id].assetId, clip.assetId);
    await page.reload(); await saved(page);
    assert.deepEqual((await project(page)).repo, committed.repo);
    assert.equal(await mediaBytes(page, clip.assetId), bytes.length);
    await playSource(page, timeline, clip);
    await page.screenshot({path: path.join(output, "retained-source-playback.png")});
    await passed({sourceBytes: bytes.length, head: committed.repo.branches.main, decodedPlayback: true}); await context.close();
  }

  for (const method of ["picker", "drop"]) {
    activeCase = `#7 ${method} reports quota failure while retaining session playback`;
    const {context, page} = await fresh({quotaFailure: true, width: 1024});
    if (method === "picker") await upload(page);
    else await page.evaluate(data => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), character => character.charCodeAt(0))], "qa-source.mp4", {type: "video/mp4"}));
      document.querySelector(".studio-timeline").dispatchEvent(new DragEvent("drop", {bubbles: true, cancelable: true, dataTransfer: transfer}));
    }, bytes.toString("base64"));
    await page.getByRole("button", {name: "Tag qa-source.mp4", exact: true}).waitFor();
    await page.getByRole("status").filter({hasText: "QA quota denied"}).waitFor();
    const stored = await project(page), clip = stored.history.log.at(-1).op.clip;
    // Temporary media remains playable, with a visible durability warning.
    const timeline = {...stored.history.base, clips: {...stored.history.base.clips, [clip.id]: clip}};
    await playSource(page, timeline, clip);
    await page.screenshot({path: path.join(output, `quota-${method}-1024.png`)});
    await passed({warning: "QA quota denied", sessionPlayback: true}); await context.close();
  }

  activeCase = "#7 drop reports a corrupt file without changing project history";
  {
    const {context, page} = await fresh(); const before = await project(page);
    await page.evaluate(() => {
      const transfer = new DataTransfer(); transfer.items.add(new File(["invalid bytes"], "corrupt.mp4", {type: "video/mp4"}));
      document.querySelector(".studio-timeline").dispatchEvent(new DragEvent("drop", {bubbles: true, cancelable: true, dataTransfer: transfer}));
    });
    await page.getByRole("status").filter({hasText: "skipped corrupt.mp4"}).waitFor();
    const after = await project(page); assert.deepEqual(after, before);
    await passed({unchanged: true}); await context.close();
  }

  for (const action of ["checkout", "away-and-back", "reset"]) {
    activeCase = `#8 pending import is canceled across ${action}`;
    const {context, page} = await fresh();
    await page.evaluate(() => {
      const create = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = async function (...args) {
        window.qaWriteHeld = true;
        await new Promise(resolve => {window.qaReleaseWrite = resolve;});
        return create.apply(this, args);
      };
    });
    await upload(page); await page.waitForFunction(() => window.qaWriteHeld === true);
    if (action === "reset") {
      page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", {name: "Reset sample", exact: true}).click();
      await page.getByRole("button", {name: "See two versions", exact: true}).waitFor();
    } else {
      await checkout(page, "alternate"); if (action === "away-and-back") await checkout(page, "main");
    }
    const before = await project(page);
    await page.evaluate(() => window.qaReleaseWrite());
    await page.getByRole("status").filter({hasText: "Import canceled"}).waitFor();
    const after = await project(page); assert.deepEqual(after, before);
    assert.equal(Object.values(after.history.base.assets).some(asset => asset.name === "qa-source.mp4"), false);
    await page.screenshot({path: path.join(output, `import-canceled-${action}.png`)});
    await passed({targetBranch: after.repo.currentBranch, unchangedProject: true}); await context.close();
  }
  assert.deepEqual(errors, []);
} catch (error) {
  results.push({name: activeCase, failed: error.message});
  if (activePage && !activePage.isClosed()) await activePage.screenshot({path: path.join(output, "failure.png")});
  throw error;
} finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify({target, results, errors}, null, 2));
  await browser.close();
}
