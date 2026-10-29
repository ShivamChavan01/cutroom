import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5186";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname));
assert.ok(process.env.TEST_VIDEO_A, "Set TEST_VIDEO_A to a local video");
const output = path.resolve(process.env.QA_OUTPUT_DIR ?? ".gstack/graph-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function until(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(100);
  }
  throw new Error("Browser condition timed out");
}
async function save(message) {
  await page.getByLabel("Commit message", { exact: true }).fill(message);
  await page.getByRole("button", { name: "Commit", exact: true }).click();
}
async function graph() {
  await page.getByRole("tab", { name: "Graph", exact: true }).click();
  await page.locator(".commit-graph").waitFor();
}
try {
  await page.goto(target);
  await page.locator('header input[type="file"]').first().setInputFiles(process.env.TEST_VIDEO_A);
  await until(async () => Object.keys((await import("/src/store.ts")).useEditorStore.getState().timeline.clips).length === 1);
  await page.getByRole("button", { name: "Versions", exact: true }).click();
  // Make an initial committed edit whether the repository was initialized before or after import.
  await page.evaluate(async () => (await import("/src/store.ts")).useEditorStore.getState().dispatch({ type: "renameProject", name: "Branch graph QA" }));
  await save("Import interview footage");
  await page.getByLabel("New branch name").fill("alternate-cut");
  await page.getByRole("button", { name: "Branch", exact: true }).click();
  await graph();
  await page.getByText("Shared tip", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "shared-tip.png") });
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await page.getByLabel("Current branch", { exact: true }).selectOption("alternate-cut");
  await page.evaluate(async () => {
    const store = (await import("/src/store.ts")).useEditorStore.getState();
    store.dispatch({ type: "trimClip", clipId: Object.keys(store.timeline.clips)[0], duration: 8000 });
  });
  await save("Shorter alternate opening");
  await page.getByLabel("Current branch", { exact: true }).selectOption("main");
  await page.evaluate(async () => {
    const store = (await import("/src/store.ts")).useEditorStore.getState();
    store.dispatch({ type: "trimClip", clipId: Object.keys(store.timeline.clips)[0], duration: 10000 });
  });
  await save("Keep a longer opening");
  await graph();
  const lanes = await page.locator("circle[data-lane]").evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.lane)));
  assert.ok(lanes.includes(0) && lanes.includes(1));
  await page.screenshot({ path: path.join(output, "fork.png") });
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await page.getByLabel("Merge source").selectOption("alternate-cut");
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await page.getByRole("button", { name: "Take theirs", exact: true }).click();
  await page.getByPlaceholder("merge commit message").fill("Merge alternate opening");
  await page.getByRole("button", { name: "Commit merge", exact: true }).click();
  await graph();
  await page.locator(".commit-graph-merge").waitFor();
  const geometry = await page.evaluate(async () => {
    const { buildCommitGraph } = await import("/src/lib/commitGraph.ts");
    const repo = (await import("/src/vcsStore.ts")).useVcsStore.getState().repo;
    const layout = buildCommitGraph(repo);
    const merge = layout.nodes.find((node) => node.commit.parents.length === 2);
    return { mergeId: merge?.commit.id, edges: layout.edges.filter((edge) => edge.from === merge?.commit.id), lanes: layout.laneCount };
  });
  assert.equal(await page.locator('path[data-edge-kind="merge"]').count(), 1);
  assert.equal(geometry.edges.length, 2);
  assert.equal(geometry.lanes, 2);
  await page.screenshot({ path: path.join(output, "merged.png") });
  const row = page.locator(".commit-graph-row").filter({ hasText: "Shorter alternate opening" });
  await row.click();
  await page.getByText("Viewing · HEAD", { exact: true }).waitFor();
  await until(async () => Object.values((await import("/src/store.ts")).useEditorStore.getState().timeline.clips)[0].duration === 8000);
  // Declining checkout with unsaved edits must retain both the edit and HEAD.
  await page.evaluate(async () => (await import("/src/store.ts")).useEditorStore.getState().dispatch({ type: "renameProject", name: "Unsaved work" }));
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator(".commit-graph-row").filter({ hasText: "Import interview footage" }).click();
  assert.equal(await page.getByText("Viewing · HEAD", { exact: true }).count(), 1);
  const unchanged = await page.evaluate(async () => (await import("/src/store.ts")).useEditorStore.getState().timeline.id);
  assert.equal(unchanged, "Unsaved work");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".commit-graph-row").filter({ hasText: "Import interview footage" }).click();
  await until(async () => (await import("/src/store.ts")).useEditorStore.getState().timeline.id === "Branch graph QA");
  await page.evaluate(async () => {
    const store = (await import("/src/vcsStore.ts")).useVcsStore.getState();
    store.createBranch("alternate-opening-with-a-long-branch-name-for-review");
    store.createBranch("backup");
  });
  await page.getByText("Shared tip", { exact: true }).waitFor();
  await page.setViewportSize({ width: 1280, height: 800 });
  const fits = await page.locator(".commit-graph").evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  assert.ok(fits, "Graph overflows its panel at laptop width");
  await page.screenshot({ path: path.join(output, "laptop.png") });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ geometry, fits, errors, checks: ["shared tips", "fork", "conflicting trim merge", "two-parent merge", "snapshot checkout", "unsaved edit guard", "laptop layout"] }, null, 2));
  console.log("PASS branch graph browser workflow");
} catch (cause) {
  await page.screenshot({ path: path.join(output, "failure.png") });
  throw cause;
} finally {
  await browser.close();
}
