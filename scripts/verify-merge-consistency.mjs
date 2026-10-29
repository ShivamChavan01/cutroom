import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.env.PROJECT_ROOT ?? ".");
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5186";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname));
assert.ok(process.env.TEST_VIDEO_A, "Set TEST_VIDEO_A to local demo footage");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const output = path.resolve(process.env.QA_OUTPUT_DIR ?? ".gstack/merge-consistency-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function until(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(100);
  }
  throw new Error("Asynchronous browser condition timed out");
}
async function fixture(mode) {
  return page.evaluate(async ({ mode, root }) => {
    const engine = await import(`/@fs${root}/packages/engine/src/index.ts`);
    const vcs = await import("/src/lib/vcs.ts");
    const editor = (await import("/src/store.ts")).useEditorStore.getState();
    const store = (await import("/src/vcsStore.ts")).useVcsStore.getState();
    const ui = (await import("/src/uiStore.ts")).useUiStore.getState();
    const asset = Object.values(editor.timeline.assets)[0];
    const a = engine.makeClip({ id: "a", trackId: "v1", assetId: asset.id, start: 0, inPoint: 0, duration: 2000, volume: 1 });
    const base = { ...engine.emptyTimeline("Merge reliability QA"), assets: { [asset.id]: asset }, clips: {
      a, b: { ...a, id: "b", start: 4000 }, c: { ...a, id: "c", start: 8000 },
    } };
    let ours = base;
    let theirs = base;
    if (mode === "overlap") {
      ours = engine.applyOp(base, { type: "moveClip", clipId: "b", start: 1000 });
      theirs = engine.applyOp(base, { type: "moveClip", clipId: "c", start: 1500 });
    } else if (mode === "metadata") {
      ours = { ...base, tracks: base.tracks.map((track) => track.id === "v1" ? { ...track, name: "Our track name" } : track), assets: { [asset.id]: { ...asset, name: "Our footage name" } } };
      theirs = { ...base, tracks: base.tracks.map((track) => track.id === "v1" ? { ...track, name: "Their track name" } : track), assets: { [asset.id]: { ...asset, name: "Their footage name" } } };
    }
    let repo = vcs.createRepo(base, "QA");
    repo = vcs.createBranch(repo, "other");
    repo = vcs.commit(repo, ours, "Our changes", "QA");
    repo = vcs.checkout(repo, "other");
    repo = vcs.commit(repo, theirs, "Their changes", "Other editor");
    repo = vcs.checkout(repo, "main");
    if (mode === "ambiguous") {
      const c1 = repo.commits.c1;
      repo = { ...repo, commits: { ...repo.commits,
        c3: { ...c1, id: "c3", parents: ["c1", "c2"], message: "Merge one" },
        c4: { ...c1, id: "c4", parents: ["c2", "c1"], message: "Merge two" },
      }, branches: { main: "c3", other: "c4" } };
    }
    editor.loadTimeline(ours);
    editor.setPlayhead(0);
    store.restoreRepo(repo);
    if (mode !== "ambiguous") {
      store.beginMerge("other");
      ui.openTab("merge");
      return (await import("/src/vcsStore.ts")).useVcsStore.getState().pending.result.conflicts.map((conflict) => conflict.kind);
    }
    ui.openTab("timeline");
    ui.setRail("versions");
    return JSON.stringify({ repo, history: (await import("/src/store.ts")).useEditorStore.getState().history });
  }, { mode, root });
}
try {
  await page.goto(target);
  await page.locator('header input[type="file"]').first().setInputFiles(process.env.TEST_VIDEO_A);
  await until(async () => Object.keys((await import("/src/store.ts")).useEditorStore.getState().timeline.assets).length === 1);
  assert.deepEqual(await fixture("overlap"), ["overlap", "overlap", "overlap"]);
  const panel = page.getByRole("tabpanel").filter({ has: page.getByPlaceholder("merge commit message") });
  await panel.getByRole("button", { name: "Keep a", exact: true }).first().click();
  const afterOne = await page.evaluate(async () => (await import("/src/vcsStore.ts")).useVcsStore.getState().pending.result);
  assert.equal(afterOne.conflicts.length, 1);
  assert.ok(afterOne.conflicts.every((conflict) => conflict.kind === "overlap" && conflict.a !== "b" && conflict.b !== "b"));
  await page.screenshot({ path: path.join(output, "one-real-overlap-remains.png") });
  await panel.getByRole("button", { name: "Keep a", exact: true }).click();
  await until(async () => (await import("/src/vcsStore.ts")).useVcsStore.getState().pending.result.clean);
  const finalClips = await page.evaluate(async () => Object.keys((await import("/src/vcsStore.ts")).useVcsStore.getState().pending.result.merged.clips));
  assert.deepEqual(finalClips, ["a"]);
  const metadataKinds = await fixture("metadata");
  assert.ok(metadataKinds.includes("trackField") && metadataKinds.includes("assetField"));
  await page.screenshot({ path: path.join(output, "metadata-conflicts.png") });
  while (await panel.getByRole("button", { name: "Take theirs", exact: true }).count()) {
    await panel.getByRole("button", { name: "Take theirs", exact: true }).first().click();
  }
  const resolved = await page.evaluate(async () => (await import("/src/vcsStore.ts")).useVcsStore.getState().pending.result);
  assert.equal(resolved.clean, true);
  assert.equal(resolved.merged.tracks[0].name, "Their track name");
  assert.equal(Object.values(resolved.merged.assets)[0].name, "Their footage name");
  await panel.getByPlaceholder("merge commit message").fill("Resolve metadata explicitly");
  await panel.getByRole("button", { name: "Commit merge", exact: true }).click();
  await until(async () => (await import("/src/vcsStore.ts")).useVcsStore.getState().pending === null);
  assert.equal(await page.evaluate(async () => (await import("/src/store.ts")).useEditorStore.getState().timeline.tracks[0].name), "Their track name");
  const before = await fixture("ambiguous");
  let alert;
  page.once("dialog", async (dialog) => { alert = dialog.message(); await dialog.accept(); });
  await page.getByLabel("Merge source", { exact: true }).selectOption("other");
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  assert.match(alert, /multiple|ambiguous|criss.cross/i);
  const after = await page.evaluate(async () => ({
    pending: (await import("/src/vcsStore.ts")).useVcsStore.getState().pending,
    snapshot: JSON.stringify({ repo: (await import("/src/vcsStore.ts")).useVcsStore.getState().repo, history: (await import("/src/store.ts")).useEditorStore.getState().history }),
  }));
  assert.equal(after.pending, null);
  assert.equal(after.snapshot, before);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ afterOne: afterOne.conflicts, finalClips, metadataKinds, alert, unchangedOnRejection: after.snapshot === before, errors }, null, 2));
  console.log("PASS merge consistency browser checks");
} catch (cause) {
  await page.screenshot({ path: path.join(output, "failure.png") });
  throw cause;
} finally {
  await browser.close();
}
