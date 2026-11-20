import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { preview } from "../apps/web/node_modules/vite/dist/node/index.js";

const [baseline, updated, firstVideo, secondVideo, output, mode] = process.argv.slice(2);
assert.ok(output, "Pass baseline build, updated build, two distinct 6-second MP4s at 30 fps, and an output JSON path");
assert.ok(mode === undefined || ["--repeat-cuts", "--continuous"].includes(mode), "Optional modes: --repeat-cuts or --continuous");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const track = '[data-player-track="v1"]';
const liveVideo = `${track} video[data-player-live="true"]`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const servers = [];

async function serve(build) {
  const server = await preview({ configFile: false, build: { outDir: resolve(build) }, preview: { host: "127.0.0.1", port: 0 } });
  servers.push(server);
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/`;
}

async function setup(url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.locator('header input[type="file"]').first().setInputFiles([firstVideo, secondVideo]);
    await page.waitForFunction(() => document.querySelectorAll('[data-clip-id]').length === 2);
    const lane = await page.getByTestId("scrub-strip").boundingBox();
    assert.ok(lane);
    const x = ms => lane.x + ms / 20; // The fresh editor defaults to 50 px/s.
    const y = lane.y + 7;
    const position = () => page.getByRole("slider", { name: "playhead" }).getAttribute("aria-valuenow").then(Number);
    const seek = async ms => {
      await page.mouse.click(x(ms), y);
      await page.waitForFunction(({ liveVideo, time }) => {
        const video = document.querySelector(liveVideo);
        return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - time) < 0.04;
      }, { liveVideo, time: ms % 6000 / 1000 });
      assert.ok(Math.abs(await position() - ms) <= 20);
      return page.locator(liveVideo).evaluate(video => video.currentSrc);
    };
    const secondSrc = await seek(7200);
    const firstSrc = await seek(4400);
    assert.notEqual(firstSrc, secondSrc, "The fixture must switch between distinct sources");
    return { context, page, errors, x, y, seek, firstSrc, secondSrc, position };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function measure(url) {
  const { context, page, errors, x, y, secondSrc, position } = await setup(url);
  try {
    const slider = page.getByRole("slider", { name: "playhead" });
    await slider.evaluate(node => {
      node.addEventListener("pointerdown", event => { window.scrubPointer = event.pointerId; }, { once: true });
    });
    await page.mouse.move(x(4400), y);
    await page.mouse.down();
    const sample = await slider.evaluate(async (node, { track, from, to, y, secondSrc, mode }) => {
      const pointerId = window.scrubPointer;
      if (!node.hasPointerCapture(pointerId)) throw new Error("The drag did not capture the pointer");
      const lane = document.querySelector('[data-testid="scrub-strip"]');
      const originalRect = lane.getBoundingClientRect;
      let laneReads = 0;
      lane.getBoundingClientRect = () => { laneReads++; return originalRect.call(lane); };
      let finalMove = Infinity;
      let lastSeekMs;
      const intermediateFrames = new Map();
      const start = performance.now();
      let mediaTime;
      let frameMs;
      const videos = [...document.querySelectorAll(`${track} video`)];
      const callbacks = new Map();
      function watch(video) {
        callbacks.set(video, video.requestVideoFrameCallback((now, frame) => {
          if (now < finalMove && video.dataset.playerLive === "true" && frame.presentationTime >= start) {
            const timelineTime = (video.currentSrc === secondSrc ? 6 : 0) + frame.mediaTime;
            if (timelineTime >= 4.4 && timelineTime < 7.6) intermediateFrames.set(timelineTime, now - start);
          }
          if (now >= finalMove && video.dataset.playerLive === "true" && video.currentSrc === secondSrc
            && Math.abs(frame.mediaTime - 1.6) <= 1 / 30 + 0.001) {
            frameMs = now - finalMove;
            mediaTime = frame.mediaTime;
          } else {
            watch(video);
          }
        }));
      }
      function onSeeked(event) {
        const video = event.currentTarget;
        if (video.currentSrc === secondSrc && Math.abs(video.currentTime - 1.6) <= 0.001) {
          lastSeekMs = performance.now() - finalMove;
        }
      }
      videos.forEach(watch);
      videos.forEach(video => video.addEventListener("seeked", onSeeked));
      const groups = mode === "--continuous" ? 60 : 15, movesPerGroup = 6;
      try {
        for (let group = 0; group < groups; group++) {
          await new Promise(requestAnimationFrame);
          for (let move = 0; move < movesPerGroup; move++) {
            const index = group * movesPerGroup + move + 1;
            const total = groups * movesPerGroup;
            if (index === total) finalMove = performance.now();
            node.dispatchEvent(new PointerEvent("pointermove", {
              pointerId, isPrimary: true, pointerType: "mouse", buttons: 1, bubbles: true,
              clientX: from + (to - from) * index / total, clientY: y,
            }));
          }
        }
        if (mode === "--continuous") {
          node.dispatchEvent(new PointerEvent("pointerup", {
            pointerId, isPrimary: true, pointerType: "mouse", bubbles: true, clientX: to, clientY: y,
          }));
        }
        const deadline = performance.now() + 3000;
        while (frameMs === undefined && performance.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (frameMs === undefined) throw new Error("Timed out waiting for the final source frame");
        return {
          moves: groups * movesPerGroup, laneReads, frameMs, mediaTime, lastSeekMs,
          dragMs: finalMove - start, intermediateFrames: intermediateFrames.size,
          framesDuringDrag: [...intermediateFrames].map(([time, presentedAtMs]) => ({ time, presentedAtMs })),
        };
      } finally {
        lane.getBoundingClientRect = originalRect;
        callbacks.forEach((id, video) => video.cancelVideoFrameCallback(id));
        videos.forEach(video => video.removeEventListener("seeked", onSeeked));
      }
    }, { track, from: x(4400), to: x(7600), y, secondSrc, mode });
    assert.ok(Math.abs(await position() - 7600) <= 20, "The drag must reach its target");
    assert.deepEqual(errors, []);
    return sample;
  } finally {
    await context.close();
  }
}

async function measureRepeatedCuts(url) {
  const { context, page, errors, x, y, firstSrc, secondSrc, position } = await setup(url);
  try {
    const slider = page.getByRole("slider", { name: "playhead" });
    const targets = [6240, 5760, 6360, 5680, 6480, 5600].map(ms => ({
      x: x(ms), source: ms < 6000 ? firstSrc : secondSrc, time: ms % 6000 / 1000,
    }));
    await slider.evaluate(node => {
      node.addEventListener("pointerdown", event => { window.scrubPointer = event.pointerId; }, { once: true });
    });
    await page.mouse.move(x(4400), y);
    await page.mouse.down();
    const result = await slider.evaluate(async (node, { track, targets, y }) => {
      const pointerId = window.scrubPointer;
      if (!node.hasPointerCapture(pointerId)) throw new Error("The drag did not capture the pointer");
      const videos = [...document.querySelectorAll(`${track} video`)];
      const latencies = targets.map(() => null);
      const callbacks = new Map();
      let active = -1;
      let movedAt;
      let sourceLoads = 0;
      const onLoad = () => { sourceLoads++; };
      function watch(video) {
        callbacks.set(video, video.requestVideoFrameCallback((now, frame) => {
          const target = targets[active];
          if (target && latencies[active] === null && frame.presentationTime >= movedAt
            && video.dataset.playerLive === "true" && video.currentSrc === target.source
            && Math.abs(frame.mediaTime - target.time) <= 1 / 30 + 0.001) {
            latencies[active] = now - movedAt;
          }
          watch(video);
        }));
      }
      videos.forEach(video => {
        video.addEventListener("loadstart", onLoad);
        watch(video);
      });
      try {
        for (const target of targets) {
          active++;
          movedAt = performance.now();
          node.dispatchEvent(new PointerEvent("pointermove", {
            pointerId, isPrimary: true, pointerType: "mouse", buttons: 1, bubbles: true,
            clientX: target.x, clientY: y,
          }));
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        const timelyFrames = latencies.filter(latency => latency !== null && latency <= 500).length;
        const deadline = performance.now() + 3000;
        while (latencies.at(-1) === null && performance.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (latencies.at(-1) === null) throw new Error("Timed out waiting for the final frame across repeated cuts");
        return { sourceLoads, timelyFrames, latencies };
      } finally {
        callbacks.forEach((id, video) => video.cancelVideoFrameCallback(id));
        videos.forEach(video => video.removeEventListener("loadstart", onLoad));
      }
    }, { track, targets, y });
    assert.ok(Math.abs(await position() - 5600) <= 20);
    assert.deepEqual(errors, []);
    return result;
  } finally {
    await context.close();
  }
}

async function verifyGesture(url) {
  const { context, page, errors, x, y, seek, secondSrc, position } = await setup(url);
  try {
    await page.mouse.move(x(3000), y);
    await page.mouse.down();
    assert.equal(await position(), 3000, "Ruler press seeks immediately");
    await page.mouse.move(x(6000), y + 40);
    await page.mouse.up();
    assert.equal(await position(), 6000, "Ruler drag continues outside the ruler");
    await page.mouse.move(x(6000), y);
    await page.mouse.down();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x(7300), y, button: "left", clickCount: 1 });
    assert.equal(await position(), 7300, "Release applies the final coordinate without a preceding move");
    const slider = page.getByRole("slider", { name: "playhead" });
    await slider.press("ArrowRight");
    assert.equal(await position(), 7400, "Keyboard seek still works");
    const ruler = page.getByTestId("timeline-ruler");
    await ruler.evaluate(node => {
      node.addEventListener("pointerdown", event => { window.scrubPointer = event.pointerId; }, { once: true });
    });
    await page.mouse.move(x(3600), y);
    await page.mouse.down();
    await ruler.evaluate(async (node, pendingX) => {
      node.dispatchEvent(new PointerEvent("pointermove", { pointerId: window.scrubPointer, clientX: pendingX, bubbles: true }));
      node.releasePointerCapture(window.scrubPointer);
      // Dispatch the cancellation before the next frame, as a browser can do
      // when it takes over a touch gesture.
      node.dispatchEvent(new PointerEvent("pointercancel", { pointerId: window.scrubPointer, bubbles: true }));
      await new Promise(requestAnimationFrame);
    }, x(4400));
    assert.equal(await position(), 3600, "Cancellation discards an unpublished position");
    await page.mouse.up();
    await seek(4400);
    const lane = await page.getByTestId("scrub-strip").boundingBox();
    await page.mouse.click(x(4400), lane.y + lane.height - 5);
    assert.equal(await position(), 4400, "Empty-lane click still seeks");
    await seek(5800);
    await page.getByRole("button", { name: "play", exact: true }).click();
    await page.waitForFunction(({ liveVideo, secondSrc }) => {
      const video = document.querySelector(liveVideo);
      return video?.currentSrc === secondSrc && !video.paused && video.currentTime >= 0.15;
    }, { liveVideo, secondSrc });
    await page.getByRole("button", { name: "pause", exact: true }).click();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

try {
  const before = await serve(baseline);
  const after = await serve(updated);
  const results = [];
  const builds = [["baseline", before], ["updated", after]];
  for (let run = 0; run < 5; run++) {
    const order = run % 2 === 0 ? builds : [...builds].reverse();
    for (const [build, url] of order) {
      const sample = await (mode === "--repeat-cuts" ? measureRepeatedCuts : measure)(url);
      if (build === "updated") {
        if (mode === "--repeat-cuts") assert.equal(sample.sourceLoads, 0, "Revisiting a loaded source must not reload it");
        else assert.ok(sample.laneReads <= (mode === "--continuous" ? 61 : 15), "Coalesce moves and read the release position");
      }
      results.push({ run: run + 1, build, ...sample });
      console.log(results.at(-1));
    }
  }
  await verifyGesture(after);
  await writeFile(output, JSON.stringify({ browser: browser.version(), gestureChecksPassed: true, results }, null, 2) + "\n");
} finally {
  await browser.close();
  await Promise.all(servers.map(server => new Promise((done, fail) => server.httpServer.close(error => error ? fail(error) : done()))));
}
