import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5186";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname));
assert.ok(process.env.TEST_VIDEO_A, "Set TEST_VIDEO_A to a local video with audio");
const output = path.resolve(process.env.QA_OUTPUT_DIR ?? ".gstack/detach-audio-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function until(predicate) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(100);
  }
  throw new Error("Browser condition timed out");
}
async function playing() {
  await page.getByRole("button", { name: "play", exact: true }).click();
  const observations = [];
  const deadline = Date.now() + 30000;
  let result;
  while (Date.now() < deadline) {
    const sample = await page.evaluate(async () => ({
      at: (await import("/src/store.ts")).useEditorStore.getState().playheadMs,
      media: [...document.querySelectorAll("video, audio")].map((element) => ({
        kind: element.tagName, time: element.currentTime, volume: element.volume,
        ready: element.readyState, paused: element.paused, error: element.error?.message ?? null,
        visible: getComputedStyle(element).display !== "none",
      })),
    }));
    observations.push(sample);
    const audio = sample.media.find((element) => element.kind === "AUDIO" && !element.paused && element.volume > 0);
    const video = sample.media.find((element) => element.kind === "VIDEO" && !element.paused && element.visible);
    if (audio && video && audio.ready >= 2 && video.ready >= 2 && !audio.error && !video.error &&
        audio.time > 3.2 && video.volume === 0 && Math.abs(audio.time - video.time) < 0.25) {
      result = sample.media.filter((element) => !element.paused);
      break;
    }
    await page.waitForTimeout(100);
  }
  if (!result) {
    await writeFile(path.join(output, "playback-observations.json"), JSON.stringify(observations, null, 2));
    throw new Error("Audio/video playback did not reach the expected gain, readiness and sync");
  }
  assert.equal(result.filter((element) => element.volume > 0).length, 1);
  assert.equal(result.find((element) => element.kind === "AUDIO")?.volume, 0.65);
  await page.getByRole("button", { name: "pause", exact: true }).click();
  return result;
}
try {
  await page.goto(target);
  await page.locator('header input[type="file"]').first().setInputFiles(process.env.TEST_VIDEO_A);
  await until(async () => Object.keys((await import("/src/store.ts")).useEditorStore.getState().timeline.clips).length === 1);
  const sourceId = await page.evaluate(async () => {
    const store = (await import("/src/store.ts")).useEditorStore.getState();
    const id = Object.keys(store.timeline.clips)[0];
    store.dispatch({ type: "trimClip", clipId: id, inPoint: 3000, duration: 8000 });
    store.dispatch({ type: "moveClip", clipId: id, start: 2000 });
    store.dispatch({ type: "setVolume", clipId: id, volume: 0.65 });
    store.setPlayhead(2000);
    return id;
  });
  await page.getByRole("button", { name: "Fit timeline", exact: true }).click();
  await page.locator('[data-track-id="v1"] [data-clip-id]').first().click();
  await page.getByRole("button", { name: "Detach audio", exact: true }).click();
  await page.locator('[data-track-id="a1"] [data-clip-id]').waitFor();
  const clips = await page.evaluate(async () => {
    const store = (await import("/src/store.ts")).useEditorStore.getState();
    const [video, audio] = Object.values(store.timeline.clips).sort((a, b) => a.trackId.localeCompare(b.trackId)).reverse();
    return { video, audio, lastOp: store.history.log.at(-1)?.op.type };
  });
  assert.equal(clips.lastOp, "detachAudio");
  assert.equal(clips.video.id, sourceId);
  assert.equal(clips.video.volume, 0);
  assert.equal(clips.audio.volume, 0.65);
  for (const key of ["assetId", "start", "inPoint", "duration", "outPoint"]) assert.equal(clips.audio[key], clips.video[key]);
  await until(() => Boolean(document.querySelector('[data-track-id="a1"] [data-waveform-state="ready"]')));
  await page.screenshot({ path: path.join(output, "detached.png") });
  const playback = await playing();
  // The selected audio can now be trimmed without changing the video.
  await page.evaluate(async () => {
    const store = (await import("/src/store.ts")).useEditorStore.getState();
    const audio = Object.values(store.timeline.clips).find((clip) => clip.trackId === "a1");
    store.dispatch({ type: "trimClip", clipId: audio.id, duration: 7000 });
  });
  await until(async () => Object.values((await import("/src/store.ts")).useEditorStore.getState().timeline.clips).find((clip) => clip.trackId === "v1").duration === 8000);
  await page.evaluate(async () => (await import("/src/store.ts")).useEditorStore.getState().undo());
  await page.keyboard.press("Control+z");
  await until(async () => Object.keys((await import("/src/store.ts")).useEditorStore.getState().timeline.clips).length === 1);
  const restoredVolume = await page.evaluate(async () => Object.values((await import("/src/store.ts")).useEditorStore.getState().timeline.clips)[0].volume);
  assert.equal(restoredVolume, 0.65);
  await page.keyboard.press("Control+Shift+z");
  await until(async () => Object.keys((await import("/src/store.ts")).useEditorStore.getState().timeline.clips).length === 2);
  await until(async () => {
    const saved = await (await import("/src/lib/persistence/storage.ts")).readProject();
    if (!saved.ok || !saved.value) return false;
    const stored = JSON.parse(saved.value);
    return stored.history.cursor === stored.history.log.length && stored.history.log.at(-1)?.op.type === "detachAudio";
  });
  await page.reload();
  await until(async () => Object.keys((await import("/src/store.ts")).useEditorStore.getState().timeline.clips).length === 2);
  await page.getByRole("button", { name: "Fit timeline", exact: true }).click();
  await until(() => Boolean(document.querySelector('[data-track-id="a1"] [data-waveform-state="ready"]')));
  await page.evaluate(async () => (await import("/src/store.ts")).useEditorStore.getState().setPlayhead(2000));
  const reloadedPlayback = await playing();
  await page.screenshot({ path: path.join(output, "reloaded.png") });
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ clips, playback, reloadedPlayback, errors, checks: ["matching source trim and timeline placement", "V1 silent and A1 at original gain", "one audible media element", "native audio and video clocks within 250ms", "A1 waveform", "independent audio trim", "single-step undo/redo", "save/reload playback"] }, null, 2));
  console.log("PASS real-video detach audio workflow");
} catch (cause) {
  await page.screenshot({ path: path.join(output, "failure.png") });
  throw cause;
} finally {
  await browser.close();
}
