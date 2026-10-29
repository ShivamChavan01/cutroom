import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5186";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname));
assert.ok(process.env.TEST_VIDEO_A, "Set TEST_VIDEO_A to real local footage");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const output = process.env.QA_OUTPUT_DIR ?? ".gstack/day1-20261029/browser-persistence";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
async function until(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(100);
  }
  throw new Error("Browser condition timed out");
}
async function snapshot() {
  return page.evaluate(async () => ({
    history: (await import("/src/store.ts")).useEditorStore.getState().history,
    timeline: (await import("/src/store.ts")).useEditorStore.getState().timeline,
    repo: (await import("/src/vcsStore.ts")).useVcsStore.getState().repo,
  }));
}
try {
  await page.goto(target);
  await page.locator('header input[type="file"]').first().setInputFiles(process.env.TEST_VIDEO_A);
  await until(async () => Object.keys((await import("/src/store.ts")).useEditorStore.getState().timeline.clips).length === 1);
  const workflow = await page.evaluate(async () => {
    const editor = (await import("/src/store.ts")).useEditorStore;
    const vcs = (await import("/src/vcsStore.ts")).useVcsStore.getState();
    vcs.commitCurrent("Imported footage");
    vcs.createBranch("alternate");
    const clip = Object.values(editor.getState().timeline.clips)[0];
    const original = JSON.stringify(editor.getState().timeline);
    editor.getState().dispatch({ type: "splitClip", clipId: clip.id, at: clip.duration / 2 });
    const split = JSON.stringify(editor.getState().timeline);
    editor.getState().undo();
    const undo = JSON.stringify(editor.getState().timeline) === original;
    editor.getState().redo();
    const redo = JSON.stringify(editor.getState().timeline) === split;
    let checkoutError;
    try { vcs.checkoutBranch("alternate"); } catch (error) { checkoutError = error.message; }
    const dirtyPreserved = JSON.stringify(editor.getState().timeline) === split;
    vcs.commitCurrent("Split footage");
    vcs.checkoutBranch("alternate");
    const branchRestored = JSON.stringify(editor.getState().timeline) === original;
    vcs.checkoutBranch("main");
    const beforeMerge = JSON.stringify(editor.getState().history);
    vcs.beginMerge("alternate");
    vcs.cancelMerge();
    const cancelledWithoutEdits = JSON.stringify(editor.getState().history) === beforeMerge;
    editor.getState().dispatch({ type: "renameProject", name: "Persisted working edit" });
    editor.getState().undo();
    return { undo, redo, checkoutError, dirtyPreserved, branchRestored, cancelledWithoutEdits };
  });
  for (const name of ["undo", "redo", "dirtyPreserved", "branchRestored", "cancelledWithoutEdits"]) assert.equal(workflow[name], true, name);
  assert.match(workflow.checkoutError, /uncommitted/i);
  const before = await snapshot();
  await until(async () => {
    const result = await (await import("/src/lib/persistence/storage.ts")).readProject();
    if (!result.ok || !result.value) return false;
    const saved = JSON.parse(result.value);
    const history = (await import("/src/store.ts")).useEditorStore.getState().history;
    const repo = (await import("/src/vcsStore.ts")).useVcsStore.getState().repo;
    return JSON.stringify(saved.history) === JSON.stringify(history) && JSON.stringify(saved.repo) === JSON.stringify(repo);
  });
  await page.reload();
  await until(async () => (await import("/src/lib/persistence/persistenceStore.ts")).usePersistenceStore.getState().status === "saved");
  assert.deepEqual(await snapshot(), before);
  await page.waitForFunction(() => [...document.querySelectorAll("video")].some(video => video.readyState >= 2 && video.videoWidth > 0 && !video.error));
  const decodedAfterRefresh = true;
  await page.evaluate(async () => (await import("/src/store.ts")).useEditorStore.getState().redo());
  assert.equal((await snapshot()).timeline.id, "Persisted working edit");
  await page.screenshot({ path: path.join(output, "restored-history-and-media.png") });
  await page.evaluate(async () => {
    const assetId = Object.keys((await import("/src/store.ts")).useEditorStore.getState().timeline.assets)[0];
    if (!await (await import("/src/lib/media/opfs.ts")).deleteMedia(assetId)) throw new Error("OPFS deletion failed");
  });
  await page.reload();
  await until(async () => (await import("/src/lib/persistence/persistenceStore.ts")).usePersistenceStore.getState().mediaWarning !== null);
  const warning = await page.evaluate(async () => (await import("/src/lib/persistence/persistenceStore.ts")).usePersistenceStore.getState().mediaWarning);
  assert.equal(warning, "1 of 1 stored media file(s) are not on disk");
  await page.screenshot({ path: path.join(output, "missing-media-warning.png") });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ workflow, decodedAfterRefresh, snapshotRestoredExactly: true, redoRestored: true, warning, errors }, null, 2));
  console.log("PASS real IndexedDB, OPFS, history refresh and branch safety checks");
} finally {
  await browser.close();
}
