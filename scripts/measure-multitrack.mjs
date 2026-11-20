import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {preview} from '../apps/web/node_modules/vite/dist/node/index.js';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const [build, videoA, videoB, output, mode] = process.argv.slice(2);
assert.ok(output && (!mode || mode === '--verify'), 'Pass a build directory, two distinct six-second 1080p30 MP4s, an output JSON path, and optionally --verify');
const files = {
  'camera-a': videoA,
  'camera-b': videoB,
  'music': 'apps/web/public/demo/pulse.wav',
};
const tracks = ['v1', 'v2', 'a1', 'a2'].map(id => ({
  id, name: id.toUpperCase(), kind: id.startsWith('v') ? 'video' : 'audio', muted: false,
}));
const assets = Object.fromEntries(Object.keys(files).map(id => [id, {
  id, name: id, kind: id === 'music' ? 'audio' : 'video', duration: id === 'music' ? 8000 : 6000,
  ...(id === 'music' ? {} : {width: 1920, height: 1080}),
}]));
const clips = {};
for (const [trackIndex, track] of tracks.entries()) {
  for (let i = 0; i < 60; i++) {
    const assetId = track.kind === 'audio' ? 'music' : (i + trackIndex) % 2 === 0 ? 'camera-a' : 'camera-b';
    const id = track.id + '-' + i;
    const inPoint = (i + trackIndex) % 3 * 1000;
    clips[id] = {id, trackId: track.id, assetId, start: i * 3000, duration: 3000, inPoint, outPoint: inPoint + 3000,
      volume: track.kind === 'audio' ? 0.1 : 0, ...(track.id === 'v2' ? {scaleX: 0.45, scaleY: 0.45} : {})};
  }
}
const timeline = {id: 'Multitrack playback', tracks, clips, assets};
const serialized = JSON.stringify({version: 2, history: {base: timeline, log: [], cursor: 0}, repo: {
  currentBranch: 'main', detachedAt: null, branches: {main: 'c0'},
  commits: {c0: {id: 'c0', at: 0, message: 'base', author: 'fixture', timeline, parents: []}},
}});
const browser = await chromium.launch({channel: 'chrome', headless: false, args: ['--mute-audio']});
let server;
try {
  server = await preview({configFile: false, build: {outDir: resolve(build)}, preview: {host: '127.0.0.1', port: 0}});
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(origin + '/setup', route => route.fulfill({contentType: 'text/html', body: '<title>Fixture</title>'}));
  for (const [id, file] of Object.entries(files)) {
    const body = await readFile(file);
    await page.route(origin + '/fixture/' + id, route => route.fulfill({body}));
  }
  await page.goto(origin + '/setup');
  await page.evaluate(async ({serialized, ids}) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('media', {create: true});
    for (const id of ids) {
      const writer = await (await dir.getFileHandle(id, {create: true})).createWritable();
      await writer.write(await (await fetch('/fixture/' + id)).blob());
      await writer.close();
    }
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('cutroom', 2);
      req.onupgradeneeded = () => req.result.createObjectStore('projects');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result, tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(serialized, 'current');
        tx.oncomplete = () => {db.close(); resolve();};
        tx.onabort = () => reject(tx.error);
      };
    });
  }, {serialized, ids: Object.keys(files)});
  await page.goto(origin);
  await page.bringToFront();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-player-live="true"]')].filter(el => el.readyState >= 2).length === 4);
  const cdp = await context.newCDPSession(page);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576 * 100) / 100;
  };
  const heapMiB = [await heap()], runs = [];
  await page.getByRole('button', {name:'Fit timeline'}).click();
  const slider = page.getByRole('slider', {name:'playhead'});
  const lane = await page.getByTestId('scrub-strip').boundingBox();
  assert.ok(lane);
  const zoom = (await page.locator('[data-clip-id="v1-0"]').boundingBox()).width / 3;
  for (const start of [0, 75, 150]) {
    await page.mouse.click(lane.x + start * zoom + 1, lane.y + 5);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-player-live="true"]')].every(el => el.readyState >= 2 && !el.seeking));
    const from = Number(await slider.getAttribute('aria-valuenow'));
    assert.ok(Math.abs(from - start * 1000) < 1000, 'seek landed at '+from+' for '+start);
    const result = await page.evaluate(async () => {
      const media = [...document.querySelectorAll('[data-player-track] video, [data-player-track] audio')];
      const videos = media.filter(el => el.tagName === 'VIDEO');
      const playhead = document.querySelector('[aria-label="playhead"]');
      const pos = () => Number(playhead.getAttribute('aria-valuenow'));
      const from = pos();
      const seeks = {};
      const onSeek = event => {
        const id = event.target.parentElement.dataset.playerTrack;
        seeks[id] = (seeks[id] ?? 0) + 1;
      };
      let loads = 0, dropped = 0, total = 0, lastPos = from, lastChange = performance.now();
      const gaps = [], seenCuts = new Set(), quality = new Map();
      const onLoad = () => {loads++;};
      const sample = () => {
        for (const video of videos) {
          const current = video.getVideoPlaybackQuality();
          const prev = quality.get(video);
          if (prev) {
            dropped += current.droppedVideoFrames >= prev.droppedVideoFrames ? current.droppedVideoFrames - prev.droppedVideoFrames : current.droppedVideoFrames;
            total += current.totalVideoFrames >= prev.totalVideoFrames ? current.totalVideoFrames - prev.totalVideoFrames : current.totalVideoFrames;
          }
          quality.set(video, current);
        }
      };
      media.forEach(el => {el.addEventListener('loadstart', onLoad); el.addEventListener('seeking', onSeek);});
      sample();
      const started = performance.now();
      document.querySelector('button[aria-label="play"]').click();
      try {
        while (performance.now() - started < 12000) {
          await new Promise(resolve => setTimeout(resolve, 20));
          sample();
          const now = performance.now(), at = pos();
          if (at !== lastPos) {
            if (now - lastChange >= 150) gaps.push({at: lastPos, ms: Math.round(now - lastChange)});
            lastChange = now;
            lastPos = at;
          }
          seenCuts.add(document.querySelector('[data-player-track="v1"]').dataset.activeClip);
        }
        return {from, end: pos(), wallMs: Math.round(performance.now() - started), loads, seeks, gaps, total, dropped, clips: seenCuts.size};
      } finally {
        document.querySelector('button[aria-label="pause"]')?.click();
        media.forEach(el => {el.removeEventListener('loadstart', onLoad); el.removeEventListener('seeking', onSeek);});
      }
    });
    console.log(JSON.stringify(result));
    assert.ok(result.end > from && result.clips >= 1 && result.total > 0);
    runs.push(result);
    heapMiB.push(await heap());
  }
  // Exercise an actual edit/undo cycle at a repeatable position, including autosave.
  const editHeapMiB = [];
  await page.getByRole('button', {name:'play', exact:true}).waitFor();
  const ruler = page.getByTestId('timeline-ruler');
  await ruler.click({position:{x:Math.round(zoom * 1.5), y:5}});
  const editTime = Number(await slider.getAttribute('aria-valuenow'));
  assert.ok(editTime > 0 && editTime < 3000, 'Edit probe must start inside the first clip, got ' + editTime);
  for (let batch = 0; batch < 3; batch++) {
    for (let edit = 0; edit < 5; edit++) {
      const clip = page.locator('[data-clip-id="v1-0"]');
      await clip.press('Enter');
      const split = page.getByRole('button', {name:'Split', exact:true});
      await split.press('Enter');
      await clip.waitFor({state:'detached'});
      await page.keyboard.press('Control+z');
      await clip.waitFor();
    }
    await page.getByText('saved', {exact:true}).first().waitFor();
    editHeapMiB.push(await heap());
  }

  if (mode === '--verify') {
    assert.ok(runs.every(run => run.loads <= 2), 'Revisiting the same two video sources should reuse the prepared media slots');
    // Hold one decoder below HAVE_CURRENT_DATA. The other native media clocks
    // must stop even when their own data is ready, then restart after recovery.
    const live = '[data-player-live="true"]';
    await page.getByRole('button', {name:'play', exact:true}).click();
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(el => !el.paused), live);
    await page.locator('[data-player-track="v1"] video[data-player-live="true"]').evaluate(video => {
      Object.defineProperty(video, 'readyState', {configurable:true, get:() => 1});
    });
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(el => el.paused), live);
    const held = await slider.getAttribute('aria-valuenow');
    await page.waitForTimeout(350);
    assert.equal(await slider.getAttribute('aria-valuenow'), held);
    assert.ok(await page.locator(live).evaluateAll(media => media.every(el => el.paused)));
    await page.locator('[data-player-track="v1"] video[data-player-live="true"]').evaluate(video => { delete video.readyState; });
    await page.waitForFunction(({live, held}) => Number(document.querySelector('[aria-label="playhead"]').getAttribute('aria-valuenow')) > Number(held) + 100
      && [...document.querySelectorAll(live)].every(el => !el.paused), {live, held});
    await page.waitForFunction(({live, clips}) => {
      const at = Number(document.querySelector('[aria-label="playhead"]').getAttribute('aria-valuenow'));
      return [...document.querySelectorAll(live)].every(el => {
        const clip = clips[el.parentElement.dataset.activeClip];
        return clip && Math.abs(el.currentTime * 1000 - (clip.inPoint + at - clip.start)) <= 250;
      });
    }, {live, clips});
    await page.getByRole('button', {name:'pause', exact:true}).click();
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(el => el.paused), live);

    // Enter and leave the single-video clock at real cut boundaries.
    for (const id of ['v2', 'a1', 'a2']) await page.getByRole('button', {name: 'Hide track ' + id, exact: true}).click();
    await ruler.click({position: {x: Math.max(1, Math.round(zoom * 0.5)), y: 5}});
    await page.getByRole('button', {name: 'play', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('[data-player-track="v1"]').dataset.activeClip === 'v1-1');
    await page.getByRole('button', {name: 'Hide track a1', exact: true}).click();
    await page.waitForFunction(({live, clips}) => {
      const at = Number(document.querySelector('[aria-label="playhead"]').getAttribute('aria-valuenow'));
      const layers = [...document.querySelectorAll(live)];
      return layers.length === 2 && at >= 6100 && layers.every(el => {
        const clip = clips[el.parentElement.dataset.activeClip];
        return clip && !el.paused && !el.seeking && Math.abs(el.currentTime * 1000 - (clip.inPoint + at - clip.start)) <= 250;
      });
    }, {live, clips});
    await page.getByRole('button', {name: 'Hide track a1', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('[data-player-track="v1"]').dataset.activeClip === 'v1-3');
    await page.getByRole('button', {name: 'pause', exact: true}).click();
  }
  assert.deepEqual(errors, []);
  await writeFile(output, JSON.stringify({chrome:browser.version(), build, runs, heapMiB, editHeapMiB, verifiedRecovery: mode === '--verify'}, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
}
