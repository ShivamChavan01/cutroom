import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, loadavg } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

export function parseOptions(args) {
  const options = { baseline: "HEAD", clips: [20, 1_000, 10_000], history: [], ticks: 120, runs: 5, output: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    const value = args[index + 1];
    assert.ok(value !== undefined && !value.startsWith("--"), `Missing value for ${flag}`);
    index += 1;
    switch (flag) {
      case "--baseline": options.baseline = value; break;
      case "--clips": options.clips = value.split(",").map(Number); break;
      case "--history": options.history = value.split(",").map(Number); break;
      case "--ticks": options.ticks = Number(value); break;
      case "--runs": options.runs = Number(value); break;
      case "--output": options.output = path.resolve(value); break;
      default: throw new Error(`Unknown option ${flag}`);
    }
  }
  assert.ok(options.clips.length > 0 && options.clips.every((count) => Number.isSafeInteger(count) && count >= 0), "Clip counts must be nonnegative integers");
  assert.ok(options.history.every((count) => Number.isSafeInteger(count) && count >= 0), "History lengths must be nonnegative integers");
  assert.ok(Number.isSafeInteger(options.ticks) && options.ticks > 0, "Ticks must be a positive integer");
  assert.ok(Number.isSafeInteger(options.runs) && options.runs >= 5, "Use at least five measured runs per side");
  return options;
}

export function createFixture(count) {
  const tracks = Array.from({ length: 8 }, (_, index) => ({ id: `t${index}`, kind: "video", name: `Track ${index}`, muted: false }));
  const clips = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const position = count - index - 1;
    const clip = {
      id: `c${position}`,
      trackId: `t${position % tracks.length}`,
      assetId: "a",
      start: Math.floor(position / tracks.length) * 2_000,
      inPoint: position % 3 * 100,
      outPoint: position % 3 * 100 + 1_700,
      duration: 1_700,
      volume: 1,
    };
    return [clip.id, clip];
  }));
  return { id: "benchmark", tracks, clips, assets: { a: { id: "a", kind: "video", duration: 2_000 } } };
}

export function expectedLayers(timeline, at, hidden = []) {
  const result = [];
  const clips = Object.values(timeline.clips);
  for (const track of timeline.tracks) {
    if (hidden.includes(track.id)) continue;
    let selected;
    for (const clip of clips) {
      if (clip.trackId !== track.id || at < clip.start || at >= clip.start + clip.duration) continue;
      if (selected === undefined || clip.start < selected.start || (clip.start === selected.start && clip.id < selected.id)) selected = clip;
    }
    if (selected !== undefined) result.push({ clip: selected, sourceTimeMs: selected.inPoint + at - selected.start, track });
  }
  return result;
}

export function summarize(samples) {
  assert.ok(samples.length > 0 && samples.every(Number.isFinite), "Samples must be nonempty and finite");
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    medianMs: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    samplesMs: samples,
  };
}

function validationCases() {
  const timeline = createFixture(0);
  const makeClip = (id, start, duration, trackId = "t0") => ({ id, start, duration, trackId, assetId: "a", inPoint: 100, outPoint: 100 + duration, volume: 1 });
  const old = { ...timeline, clips: { z: makeClip("z", 100, 1_000), a: makeClip("a", 100, 100), long: makeClip("long", 150, 2_000), sound: makeClip("sound", 0, 1_000, "t1"), orphan: makeClip("orphan", 0, 100, "missing") } };
  const edited = { ...old, clips: { ...old.clips, a: makeClip("a", 2_000, 100), extra: makeClip("extra", 4_000, 100) } };
  return [
    { timeline, times: [-1, 0, 1], hidden: [] },
    { timeline: old, times: [-1, 0, 99, 100, 150, 199, 200, 999, 1_000, 1_099, 1_100, 2_149, 2_150, 10_000], hidden: [] },
    { timeline: old, times: [0, 100, 500], hidden: ["t0"] },
    { timeline: edited, times: [100, 200, 2_000, 4_000], hidden: [] },
    { timeline: { ...edited, tracks: [...edited.tracks].reverse() }, times: [500], hidden: [] },
    { timeline: old, times: [100, 200, 1_100], hidden: [] },
  ];
}

async function loadBundle(esbuild, baselineSha, kind) {
  const contents = kind === "playback"
    ? 'export { resolvePlaybackLayers } from "./lib/playback.ts";'
    : 'export { useEditorStore } from "./store.ts"; export { createHistory, record, current } from "@cutroom/engine";';
  const result = await esbuild.build({
    stdin: { contents, loader: "ts", resolveDir: path.join(root, "apps/web/src"), sourcefile: `cutroom-${kind}-entry.ts` },
    bundle: true,
    platform: "node",
    format: "esm",
    define: { "process.env.NODE_ENV": '"production"' },
    write: false,
    plugins: baselineSha === null ? [] : [{
      name: "frozen-git-source",
      setup(build) {
        build.onLoad({ filter: /\.[jt]sx?$/ }, (args) => {
          const relative = path.relative(root, args.path).split(path.sep).join("/");
          if (!relative.startsWith("apps/web/src/") && !relative.startsWith("packages/engine/src/")) return undefined;
          const contents = execFileSync("git", ["show", `${baselineSha}:${relative}`], { cwd: root, encoding: "utf8" });
          return { contents, loader: relative.endsWith("tsx") ? "tsx" : "ts", resolveDir: path.dirname(args.path) };
        });
      },
    }],
  });
  assert.equal(result.outputFiles.length, 1, "Expected one self-contained resolver bundle");
  const label = baselineSha === null ? "worktree" : baselineSha;
  const code = result.outputFiles[0].text + `\n//# sourceURL=cutroom-playback-${label}.mjs\n`;
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  assert.equal(typeof (kind === "playback" ? loaded.resolvePlaybackLayers : loaded.useEditorStore), "function");
  return { loaded, bundleSha256: createHash("sha256").update(result.outputFiles[0].text).digest("hex") };
}

function validate(resolve, cases) {
  let lookups = 0;
  let layers = 0;
  for (const { timeline, times, hidden } of cases) {
    for (const at of times) {
      const expected = expectedLayers(timeline, at, hidden);
      const actual = resolve(timeline, at, hidden);
      assert.deepEqual(actual, expected, `Playback mismatch at ${at} ms`);
      lookups += 1;
      layers += actual.length;
    }
  }
  return { lookups, layers, errors: 0 };
}

function timedLookup(resolve, timeline, times, expectedChecksum, expectedCount) {
  let checksum = 0;
  let layers = 0;
  const cpu = process.cpuUsage();
  const start = performance.now();
  for (const at of times) {
    for (const layer of resolve(timeline, at)) {
      checksum += layer.sourceTimeMs + layer.clip.id.length;
      layers += 1;
    }
  }
  const elapsedMs = performance.now() - start;
  const cpuUsed = process.cpuUsage(cpu);
  assert.equal(checksum, expectedChecksum, "Timed work returned an incorrect checksum");
  assert.equal(layers, expectedCount, "Timed work returned an incorrect layer count");
  return { msPerLookup: elapsedMs / times.length, lookups: times.length, layers, checksum, cpuMs: (cpuUsed.user + cpuUsed.system) / 1_000 };
}

function measureColdRevision(baseline, worktree, timeline, at, runCount) {
  const expected = expectedLayers(timeline, at);
  const checksum = expected.reduce((sum, layer) => sum + layer.sourceTimeMs + layer.clip.id.length, 0);
  const samples = { baseline: [], worktree: [] };
  for (let run = 0; run < runCount; run += 1) {
    const order = run % 2 === 0 ? [["baseline", baseline], ["worktree", worktree]] : [["worktree", worktree], ["baseline", baseline]];
    for (const [name, resolve] of order) {
      const revision = { ...timeline, clips: { ...timeline.clips } };
      samples[name].push(timedLookup(resolve, revision, [at], checksum, expected.length));
      validate(resolve, [{ timeline: revision, times: [at], hidden: [] }]);
    }
  }
  return Object.fromEntries(Object.entries(samples).map(([name, runs]) => [name, { ...summarize(runs.map((run) => run.msPerLookup)), runs }]));
}

function measureHistoryDispatch(baseline, worktree, operationCount, runCount) {
  const fixture = createFixture(1_000);
  const samples = { baseline: [], worktree: [] };
  const histories = new Map();
  for (const loaded of [baseline, worktree]) {
    let history = loaded.createHistory(fixture);
    for (let index = 0; index < operationCount; index += 1) history = loaded.record(history, { type: "setVolume", clipId: "c0", volume: index % 11 / 10 }, "benchmark-author");
    histories.set(loaded, history);
  }
  for (let run = 0; run < runCount + 1; run += 1) {
    const order = run % 2 === 0 ? [["baseline", baseline], ["worktree", worktree]] : [["worktree", worktree], ["baseline", baseline]];
    for (const [name, loaded] of order) {
      const store = loaded.useEditorStore;
      store.getState().restoreHistory(histories.get(loaded));
      const before = store.getState();
      const cpu = process.cpuUsage();
      const start = performance.now();
      before.dispatch({ type: "setVolume", clipId: "c0", volume: 0.37 });
      const elapsedMs = performance.now() - start;
      const cpuUsed = process.cpuUsage(cpu);
      const after = store.getState();
      assert.equal(after.timeline.clips.c0.volume, 0.37);
      assert.equal(after.history.cursor, operationCount + 1);
      assert.equal(after.history.log.length, operationCount + 1);
      assert.deepEqual(after.timeline, baseline.current(after.history), "Store output differs from frozen baseline history replay");
      assert.deepEqual(after.timeline.clips.c1, before.timeline.clips.c1, "Dispatch changed an unrelated clip");
      if (run > 0) samples[name].push({ elapsedMs, dispatches: 1, operationsInResult: after.history.cursor, untouchedClipReferencePreserved: after.timeline.clips.c1 === before.timeline.clips.c1, cpuMs: (cpuUsed.user + cpuUsed.system) / 1_000 });
    }
  }
  return {
    clips: 1_000,
    priorOperations: operationCount,
    measuredRunsPerSide: runCount,
    warmupDispatchesPerSide: 1,
    errors: 0,
    ...Object.fromEntries(Object.entries(samples).map(([name, runs]) => [name, { ...summarize(runs.map((run) => run.elapsedMs)), runs }])),
  };
}

export async function measure(options) {
  const baselineSha = execFileSync("git", ["rev-parse", "--verify", `${options.baseline}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
  const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("vite", { paths: [path.join(root, "apps/web")] })] }));
  const baselineBundle = await loadBundle(esbuild, baselineSha, "playback");
  const worktreeBundle = await loadBundle(esbuild, null, "playback");
  const baseline = baselineBundle.loaded.resolvePlaybackLayers;
  const worktree = worktreeBundle.loaded.resolvePlaybackLayers;
  const cases = validationCases();
  const results = [];
  const started = new Date().toISOString();
  const initialLoad = loadavg();
  for (const count of options.clips) {
    const timeline = createFixture(count);
    const duration = Math.max(1, Math.ceil(count / timeline.tracks.length)) * 2_000;
    const times = Array.from({ length: options.ticks }, (_, index) => Math.floor(index * duration / options.ticks));
    const fixtureCases = [...cases, { timeline, times, hidden: [] }];
    const validated = { baseline: validate(baseline, fixtureCases), worktree: validate(worktree, fixtureCases) };
    const expected = times.flatMap((at) => expectedLayers(timeline, at));
    const expectedChecksum = expected.reduce((sum, layer) => sum + layer.sourceTimeMs + layer.clip.id.length, 0);
    const expectedCount = expected.length;
    const warmTimes = times.slice(0, Math.min(20, times.length));
    for (const resolve of [baseline, worktree]) for (const at of warmTimes) resolve(timeline, at);
    const samples = { baseline: [], worktree: [] };
    for (let run = 0; run < options.runs; run += 1) {
      const order = run % 2 === 0 ? [["baseline", baseline], ["worktree", worktree]] : [["worktree", worktree], ["baseline", baseline]];
      for (const [name, resolve] of order) samples[name].push(timedLookup(resolve, timeline, times, expectedChecksum, expectedCount));
    }
    const summarized = Object.fromEntries(Object.entries(samples).map(([name, runs]) => [name, { ...summarize(runs.map((run) => run.msPerLookup)), runs }]));
    const coldRevision = measureColdRevision(baseline, worktree, timeline, Math.floor(duration / 2), options.runs);
    results.push({ clips: count, tracks: timeline.tracks.length, ticksPerRun: times.length, measuredRunsPerSide: options.runs, validated, ...summarized, coldRevision });
  }
  const historyResults = [];
  let historyBundleSha256 = null;
  if (options.history.length > 0) {
    const baselineStore = await loadBundle(esbuild, baselineSha, "store");
    const worktreeStore = await loadBundle(esbuild, null, "store");
    historyBundleSha256 = { baseline: baselineStore.bundleSha256, worktree: worktreeStore.bundleSha256 };
    for (const count of options.history) historyResults.push(measureHistoryDispatch(baselineStore.loaded, worktreeStore.loaded, count, options.runs));
  }
  return {
    metric: "pure playback-layer resolution, milliseconds per lookup",
    excludes: ["React rendering", "DOM layout", "video decoding", "store subscriptions"],
    coldRevisionMetric: "First lookup on a fresh immutable clips record, milliseconds including index build; record cloning and independent output validation are outside timing",
    historyDispatchMetric: "Single store.dispatch with 1000 clips, milliseconds; history construction, restore, and canonical replay validation are outside timing",
    baselineSha,
    bundleSha256: { baseline: baselineBundle.bundleSha256, worktree: worktreeBundle.bundleSha256 },
    historyBundleSha256,
    worktreeHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    started,
    finished: new Date().toISOString(),
    node: process.version,
    cpuCount: cpus().length,
    cpuModel: cpus()[0]?.model ?? "unknown",
    initialLoad,
    finalLoad: loadavg(),
    warmupLookupsPerSide: Math.min(20, options.ticks),
    order: "Alternating baseline then worktree; reverse pair order on every other run",
    errors: 0,
    results,
    historyDispatch: historyResults,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/measure-editor-performance.mjs [--baseline REF] [--clips 20,1000,10000] [--ticks 120] [--runs 5] [--history 100,1000] [--output FILE]\nMeasures the existing resolver against a frozen git ref. At least five runs per side. Validates output independently before timing. Defaults include a synthetic stress case. Optional history dispatch uses 1000 clips. Results do not measure browser FPS.");
    return;
  }
  const report = await measure(options);
  const json = JSON.stringify(report, null, 2) + "\n";
  if (options.output !== null) {
    await mkdir(path.dirname(options.output), { recursive: true });
    await writeFile(options.output, json);
  }
  process.stdout.write(json);
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({ errors: 1, message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
