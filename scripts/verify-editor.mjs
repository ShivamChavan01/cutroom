import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5186";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname), "Use an isolated local editor");
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(playwrightModule ? pathToFileURL(playwrightModule).href : "playwright");
const output = process.env.QA_OUTPUT_DIR ?? path.join(root, ".gstack", "media-fix-" + Date.now());
await mkdir(output, { recursive: true });
const results = [];
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "chrome", headless: true });
const original = path.join(root, "apps/web/public/test-a.mp4");
const shortA = process.env.TEST_VIDEO_A;
const shortB = process.env.TEST_VIDEO_B;

async function clipName(file) {
  return "clip-" + createHash("sha256").update(await readFile(file)).digest("hex").slice(0, 8);
}

async function capture(page, name) {
  const result = {
    name,
    text: await page.locator("body").innerText(),
    videos: await page.locator("video").evaluateAll((videos) => videos.map((video) => ({
      source: video.currentSrc,
      time: video.currentTime,
      ready: video.readyState,
      width: video.videoWidth,
      paused: video.paused,
      visible: getComputedStyle(video).display !== "none",
      error: video.error?.message ?? null,
    }))),
  };
  results.push(result);
  await writeFile(path.join(output, "observations.json"), JSON.stringify(results, null, 2));
  await page.screenshot({ path: path.join(output, name + ".png") });
  console.log((name.endsWith("-failure") ? "FAIL " : "PASS ") + name);
}

async function decoded(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("video")].some((video) =>
    getComputedStyle(video).display !== "none" && video.readyState >= 2 && video.videoWidth > 0 && !video.error));
  await page.waitForFunction(() => [...document.querySelectorAll(".media-poster-image")].some((image) => image.naturalWidth > 0));
  assert.equal(await page.getByText(/Media not local yet/).count(), 0);
}

async function fittedLayout(page) {
  const layout = await page.evaluate(() => {
    const video = [...document.querySelectorAll("video")].find((item) => getComputedStyle(item).display !== "none");
    const preview = document.querySelector(".preview-player");
    const side = document.querySelector('aside[aria-label="side panel"]');
    const sequence = document.querySelector('[aria-label="Sequence workspace"]');
    const workspace = document.querySelector('.editorial-workspace');
    if (!video || !preview || !side || !sequence || !workspace) throw new Error("Missing editor layout");
    const bounds = preview.getBoundingClientRect();
    const frame = video.getBoundingClientRect();
    const sideBounds = side.getBoundingClientRect();
    return {
      frameFits: frame.height > 0 && frame.top >= bounds.top && frame.bottom <= bounds.bottom && frame.left >= bounds.left && frame.right <= bounds.right,
      objectFit: getComputedStyle(video).objectFit,
      fullWidthSequence: sequence.getBoundingClientRect().width >= workspace.getBoundingClientRect().width - 2,
      sequenceBelowMonitor: sequence.getBoundingClientRect().top >= bounds.bottom,
      sidebarFits: side.scrollWidth <= side.clientWidth + 1,
      controlsFit: [...side.querySelectorAll('input:not([type="file"]), select, button')].every((control) => {
        const box = control.getBoundingClientRect();
        return box.left >= sideBounds.left - 1 && box.right <= sideBounds.right + 1;
      }),
    };
  });
  assert.deepEqual(layout, { frameFits: true, objectFit: "contain", fullWidthSequence: true, sequenceBelowMonitor: true, sidebarFits: true, controlsFit: true });
}

async function play(page) {
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("video")].some((video) =>
    getComputedStyle(video).display !== "none" && !video.paused && video.currentTime > 0.15));
}

async function pause(page) {
  const button = page.getByRole("button", { name: "pause", exact: true });
  if (await button.count()) await button.click();
}

async function commit(page, message) {
  await page.getByPlaceholder("commit message", { exact: true }).fill(message);
  await page.getByRole("button", { name: "Commit", exact: true }).click();
}

async function split(page, name, steps) {
  await page.getByRole("button", { name: "clip " + name, exact: true }).click();
  await page.getByRole("slider", { name: "playhead" }).focus();
  for (let index = 0; index < steps; index++) await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Split", exact: true }).click();
}

async function run(name, flow) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(target);
    await flow(page);
    assert.deepEqual(errors, [], "No uncaught browser errors");
  } catch (error) {
    await capture(page, name + "-failure");
    throw error;
  } finally {
    await context.close();
  }
}

try {
  await run("original-video", async (page) => {
    await page.locator("header input[type=file]").first().setInputFiles(original);
    await decoded(page);
    await fittedLayout(page);
    await play(page);
    await capture(page, "original-upload-playing");
    await pause(page);
    await page.getByText("saved", { exact: true }).waitFor();
    await page.reload();
    await decoded(page);
    await capture(page, "restored-without-interaction");
    await play(page);
    await capture(page, "restored-playing");
    await pause(page);
    await page.getByRole("button", { name: "Issues", exact: true }).click();
    await page.getByRole("button", { name: "Open issues panel", exact: true }).click();
    assert.equal(await page.locator(".studio-review-toggle").getAttribute("aria-expanded"), "true");
    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    await page.locator(".studio-review-toggle").click();
    assert.equal(await page.locator(".studio-review-toggle").getAttribute("aria-expanded"), "false");
    await capture(page, "review-drawer-open-and-close");
  });

  assert.ok(shortA && shortB, "Set TEST_VIDEO_A and TEST_VIDEO_B to two short demo MP4s for boundary and merge checks");
  await run("editing-and-merge", async (page) => {
    const firstName = await clipName(shortA);
    await page.locator("header input[type=file]").first().setInputFiles([shortA, shortB]);
    await page.getByRole("button", { name: "clip " + await clipName(shortB), exact: true }).waitFor();
    await decoded(page);
    const firstSource = await page.locator("video:visible").getAttribute("src");
    await play(page);
    await page.waitForFunction((source) => [...document.querySelectorAll("video")].some((video) =>
      getComputedStyle(video).display !== "none" && video.currentSrc !== source && !video.paused && video.videoWidth > 0), firstSource);
    await capture(page, "boundary-switched-and-playing");
    await pause(page);
    await page.getByRole("button", { name: "previous cut", exact: true }).click();
    await page.getByRole("button", { name: "previous cut", exact: true }).click();
    await split(page, firstName, 3);
    assert.equal(await page.getByRole("button", { name: "clip " + firstName, exact: true }).count(), 0);
    await page.keyboard.press("Control+z");
    await page.getByRole("button", { name: "clip " + firstName, exact: true }).waitFor();
    await page.keyboard.press("Control+Shift+z");
    assert.equal(await page.getByRole("button", { name: "clip " + firstName, exact: true }).count(), 0);
    await capture(page, "split-undo-redo");
    await page.keyboard.press("Control+z");
    await page.getByRole("button", { name: "Versions", exact: true }).click();
    assert.ok(await page.locator(".vcs-summary.text-warn").evaluate((item) => {
      const sample = document.createElement("span");
      sample.style.color = "var(--color-warn)";
      document.body.append(sample);
      const matches = getComputedStyle(item).color === getComputedStyle(sample).color;
      sample.remove();
      return matches;
    }), "Verification warnings use the current theme's warning colour");
    await fittedLayout(page);
    await page.setViewportSize({ width: 1100, height: 720 });
    await fittedLayout(page);
    await capture(page, "laptop-layout-fits");
    await page.setViewportSize({ width: 1440, height: 900 });
    await commit(page, "QA base");
    await page.getByPlaceholder("new branch").fill("qa-alternate");
    await page.getByRole("button", { name: "Branch", exact: true }).click();
    await page.getByRole("combobox", { name: "Current branch", exact: true }).selectOption({ label: "qa-alternate" });
    await split(page, firstName, 6);
    await commit(page, "QA alternate split");
    await page.getByRole("combobox", { name: "Current branch", exact: true }).selectOption({ label: "main" });
    await split(page, firstName, 3);
    await commit(page, "QA main split");
    await page.getByRole("combobox", { name: "Merge source", exact: true }).selectOption({ label: "qa-alternate" });
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    const header = page.locator("header").filter({ hasText: "Merging" });
    assert.match(await header.innerText(), /Merging qa-alternate into main/);
    await page.getByText(/This merge introduces/).waitFor();
    await capture(page, "merge-conflicts-and-verification");
    const keep = page.getByRole("button", { name: new RegExp("Keep " + firstName + "~300~") });
    for (let index = 0; index < 8 && await keep.count(); index++) await keep.first().click();
    await page.getByText(/clean, ready to commit/).waitFor();
    assert.equal(await page.getByText(/This merge introduces/).count(), 0);
    await page.getByPlaceholder("merge commit message").fill("QA resolved merge");
    await page.getByRole("button", { name: "Commit merge", exact: true }).click();
    await page.getByRole("button", { name: /QA resolved merge/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Commit merge", exact: true }).count(), 0);
    assert.equal(await page.getByRole("combobox", { name: "Current branch", exact: true }).inputValue(), "main");
    await capture(page, "merge-committed-on-main");
    await page.getByText("saved", { exact: true }).waitFor();
    await page.reload();
    await decoded(page);
    await page.getByRole("button", { name: "Versions", exact: true }).click();
    await page.getByRole("button", { name: /QA resolved merge/ }).waitFor();
    await capture(page, "merge-and-media-restored");
  });
} finally {
  await browser.close();
  console.log("Evidence " + output);
}
