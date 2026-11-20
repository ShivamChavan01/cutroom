import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {preview} from '../apps/web/node_modules/vite/dist/node/index.js';

const [build, file, output, mode] = process.argv.slice(2);
assert.ok(output && (!mode || mode === '--baseline'), 'Pass a production build, a video of at least 10 seconds, and an output JSON path.');
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({channel: 'chrome', headless: false, args: ['--mute-audio']});
const runs = [];
let server;
try {
  server = await preview({configFile: false, build: {outDir: resolve(build)}, preview: {host: '127.0.0.1', port: 0}});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port);
  await page.locator('header input[type=file]').first().setInputFiles(file);
  const live = 'video[data-player-live="true"]';
  await page.waitForFunction(selector => document.querySelector(selector)?.readyState >= 2, live);
  const duration = await page.locator(live).evaluate(video => video.duration);
  assert.ok(duration >= 10, 'Fixture must cover the playback windows');
  await page.getByRole('button', {name: 'Fit timeline'}).click();
  const zoom = Number(await page.getByRole('slider', {name: 'Timeline zoom'}).inputValue());
  const ruler = page.getByTestId('timeline-ruler');
  for (const seconds of [0, 3, 6]) {
    if (seconds > 0) {
      const bounds = await ruler.boundingBox();
      assert.ok(bounds);
      await page.mouse.click(bounds.x + Math.round(seconds * zoom), bounds.y + 5);
    }
    await page.waitForFunction(({live, seconds}) => {
      const video = document.querySelector(live);
      return video.paused && !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - seconds) < 0.1;
    }, {live, seconds}, {timeout: 30000});
    const result = await page.locator(live).evaluate(async video => {
      let seeks = 0, pauses = 0, frames = 0, callback;
      const requests = [];
      const clock = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(video, 'currentTime', {...clock, set(target) {
        requests.push({target, from: clock.get.call(this), at: Number(document.querySelector('[aria-label="playhead"]').getAttribute('aria-valuenow'))});
        clock.set.call(this, target);
      }});
      const seek = () => {seeks++;};
      const pause = () => {pauses++;};
      const sample = () => {callback = video.requestVideoFrameCallback(() => {frames++; sample();});};
      video.addEventListener('seeking', seek);
      video.addEventListener('pause', pause);
      const playhead = () => Number(document.querySelector('[aria-label="playhead"]').getAttribute('aria-valuenow'));
      const startMs = playhead();
      const from = video.currentTime, started = performance.now();
      sample();
      try {
        document.querySelector('button[aria-label="play"]').click();
        await new Promise(resolve => setTimeout(resolve, 3000));
        return {from, to: video.currentTime, startMs, endMs: playhead(), frames, requests, seeks, pauses, paused: video.paused, wallMs: performance.now() - started};
      } finally {
        delete video.currentTime;
        video.cancelVideoFrameCallback(callback);
        video.removeEventListener('seeking', seek);
        video.removeEventListener('pause', pause);
        document.querySelector('button[aria-label="pause"]')?.click();
      }
    });
    runs.push(result);
    console.log(JSON.stringify(result));
    if (mode !== '--baseline') {
      assert.ok(result.frames > 0 && result.to > result.from, 'Playback must actually present frames');
      assert.ok(result.endMs > result.startMs && Math.abs(result.endMs - result.to * 1000) <= 250, 'The timeline must follow the playing video');
      assert.equal(result.requests.length, 0, 'A waiting video must not be assigned a correction seek');
      assert.equal(result.pauses, 0, 'A lone video must recover without an editor pause');
      assert.equal(result.paused, false);
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(output, JSON.stringify({chrome: browser.version(), runs}, null, 2));
  await browser.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
}
