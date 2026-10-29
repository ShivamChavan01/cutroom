import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFixture, expectedLayers, measure, parseOptions, summarize } from "./measure-editor-performance.mjs";

describe("performance measurement inputs", () => {
  it("accepts defaults and explicit repeatable workloads", () => {
    expect(parseOptions([])).toMatchObject({ baseline: "HEAD", clips: [20, 1_000, 10_000], ticks: 120, runs: 5, help: false });
    expect(parseOptions(["--baseline", "HEAD~1", "--clips", "0,8", "--ticks", "3", "--runs", "7", "--history", "0,100", "--output", "result.json", "--help"]))
      .toMatchObject({ baseline: "HEAD~1", clips: [0, 8], ticks: 3, runs: 7, history: [0, 100], help: true });
  });

  it.each([
    ["--unknown", "value"], ["--ticks"], ["--ticks", "0"], ["--ticks", "NaN"],
    ["--runs", "4"], ["--runs", "5.5"], ["--clips", "-1"], ["--clips", "1,bad"], ["--history", "-1"],
  ])("rejects malformed options %j", (...args) => {
    expect(() => parseOptions(args)).toThrow();
  });

  it("builds unsorted clips with source offsets, track distribution and gaps", () => {
    const timeline = createFixture(10);
    expect(Object.keys(timeline.clips)).toHaveLength(10);
    expect(Object.values(timeline.clips)[0].id).toBe("c9");
    expect(expectedLayers(timeline, 0)).toHaveLength(8);
    expect(expectedLayers(timeline, 1_800)).toEqual([]);
    expect(expectedLayers(timeline, 2_000)).toHaveLength(2);
    expect(expectedLayers(createFixture(0), 0)).toEqual([]);
  });
});

describe("independent playback oracle", () => {
  it("selects the earliest active clip, breaks ties by id and keeps half-open boundaries", () => {
    const empty = createFixture(0);
    const clip = { id: "z", trackId: "t0", start: 100, duration: 1_000, inPoint: 500, outPoint: 1_500, assetId: "a", volume: 1 };
    const timeline = { ...empty, clips: { z: clip, a: { ...clip, id: "a", duration: 100 }, later: { ...clip, id: "later", start: 150, duration: 2_000 } } };
    expect(expectedLayers(timeline, 99)).toEqual([]);
    expect(expectedLayers(timeline, 100)[0]).toMatchObject({ clip: { id: "a" }, sourceTimeMs: 500 });
    expect(expectedLayers(timeline, 200)[0].clip.id).toBe("z");
    expect(expectedLayers(timeline, 1_100)[0].clip.id).toBe("later");
    expect(expectedLayers(timeline, 2_150)).toEqual([]);
    expect(expectedLayers(timeline, 100, ["t0"])).toEqual([]);
    expect(expectedLayers({ ...timeline, tracks: [] }, 100)).toEqual([]);
  });

  it("calculates median and range without mutating samples", () => {
    const samples = [3, 1, 2];
    expect(summarize(samples)).toEqual({ medianMs: 2, minMs: 1, maxMs: 3, samplesMs: samples });
    expect(samples).toEqual([3, 1, 2]);
    expect(summarize([4, 1, 3, 2]).medianMs).toBe(2.5);
    expect(() => summarize([])).toThrow();
    expect(() => summarize([NaN])).toThrow();
  });
});

describe("real bundled performance comparison", () => {
  it("loads a frozen baseline, validates both resolvers and consumes timed work", async () => {
    const result = await measure(parseOptions(["--clips", "0,20", "--ticks", "6"]));
    expect(result.errors).toBe(0);
    expect(result.baselineSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.bundleSha256.baseline).toMatch(/^[0-9a-f]{64}$/);
    expect(result.bundleSha256.worktree).toMatch(/^[0-9a-f]{64}$/);
    expect(result.results).toHaveLength(2);
    for (const fixture of result.results) {
      expect(fixture.baseline.samplesMs).toHaveLength(5);
      expect(fixture.worktree.samplesMs).toHaveLength(5);
      expect(fixture.validated.baseline.errors).toBe(0);
      expect(fixture.validated.worktree).toEqual(fixture.validated.baseline);
      expect(fixture.baseline.runs.map((run) => [run.lookups, run.layers, run.checksum]))
        .toEqual(fixture.worktree.runs.map((run) => [run.lookups, run.layers, run.checksum]));
      expect(fixture.baseline.runs.every((run) => run.lookups === 6)).toBe(true);
      expect(fixture.coldRevision.baseline.samplesMs).toHaveLength(5);
      expect(fixture.coldRevision.worktree.samplesMs).toHaveLength(5);
      expect(fixture.coldRevision.baseline.runs.map((run) => [run.lookups, run.layers, run.checksum]))
        .toEqual(fixture.coldRevision.worktree.runs.map((run) => [run.lookups, run.layers, run.checksum]));
    }
    expect(result.results[1].baseline.runs[0].layers).toBeGreaterThan(0);
  });

  it("measures a real dispatch after restoring a log and verifies it against canonical replay", async () => {
    const result = await measure(parseOptions(["--clips", "0", "--ticks", "1", "--history", "0,10"]));
    expect(result.historyBundleSha256.baseline).toMatch(/^[0-9a-f]{64}$/);
    expect(result.historyBundleSha256.worktree).toMatch(/^[0-9a-f]{64}$/);
    expect(result.historyDispatch.map((fixture) => fixture.priorOperations)).toEqual([0, 10]);
    for (const fixture of result.historyDispatch) {
      expect(fixture.errors).toBe(0);
      for (const side of [fixture.baseline, fixture.worktree]) {
        expect(side.runs).toHaveLength(5);
        expect(side.runs.every((run) => run.dispatches === 1 && run.operationsInResult === fixture.priorOperations + 1)).toBe(true);
        expect(side.runs.every((run) => run.untouchedClipReferencePreserved)).toBe(true);
      }
    }
  });

  it("prints help, writes a report and exits unsuccessfully for invalid arguments", async () => {
    const script = fileURLToPath(new URL("./measure-editor-performance.mjs", import.meta.url));
    expect(execFileSync(process.execPath, [script, "--help"], { encoding: "utf8" })).toContain("Results do not measure browser FPS");
    expect(() => execFileSync(process.execPath, [script, "--ticks", "0"], { stdio: "pipe" })).toThrow();
    const directory = await mkdtemp(path.join(tmpdir(), "cutroom-perf-test-"));
    try {
      const output = path.join(directory, "nested", "report.json");
      const printed = execFileSync(process.execPath, [script, "--clips", "8", "--ticks", "3", "--output", output], { encoding: "utf8" });
      const saved = await readFile(output, "utf8");
      expect(printed).toBe(saved);
      expect(JSON.parse(saved)).toMatchObject({ errors: 0, results: [{ clips: 8, measuredRunsPerSide: 5, ticksPerRun: 3 }] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
