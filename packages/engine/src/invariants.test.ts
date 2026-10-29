import { expect, it } from "vitest";
import { applyOp, applyOps, clipIsWellFormed, conflictKey, createHistory, current, emptyTimeline, makeClip, mergeTimelines, record, redo, resolveField, splitChildId, undo, type Op } from "./index";

it("replays deterministic seeded edit streams, including split, undo, redo and abandoned redo", () => {
  const seed = 73129;
  let random = seed;
  const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
  const base = { ...emptyTimeline(), assets: { media: { id: "media", kind: "video" as const, duration: 100000 } } };
  const before = JSON.stringify(base);
  const ops: Op[] = Array.from({ length: 20 }, (_, i) => ({ type: "addClip", clip: makeClip({ id: `c${i}`, trackId: "v1", assetId: "media", start: i * 2000, inPoint: 0, duration: 1000, volume: 1 }) }));
  for (let i = 0; i < 60; i++) ops.push({ type: "moveClip", clipId: `c${next() % 20}`, start: next() % 50000 });
  ops.push({ type: "splitClip", clipId: "c0", at: 400 });
  let h = createHistory(base);
  for (const op of ops) h = record(h, op, "tester");
  const snapshot = current(h);
  expect(applyOps(base, JSON.parse(JSON.stringify(ops))), `seed ${seed}`).toEqual(snapshot);
  expect(current(redo(undo(h)))).toEqual(snapshot);
  const rewound = undo(h);
  expect(current(record(rewound, { type: "setVolume", clipId: "c0", volume: 0.5 }, "tester")).clips.c0?.volume).toBe(0.5);
  expect(record(rewound, { type: "deleteClip", clipId: "c0" }, "tester").log).toHaveLength(ops.length);
  expect(snapshot.clips[splitChildId("c0", 400, "L")]?.duration).toBe(400);
  expect(JSON.stringify(base)).toBe(before);
  for (const [id, clip] of Object.entries(snapshot.clips)) {
    expect(clip.id, `seed ${seed}`).toBe(id);
    expect(clipIsWellFormed(clip)).toBe(true);
    expect(snapshot.assets[clip.assetId]).toBeDefined();
    expect(snapshot.tracks.some(t => t.id === clip.trackId)).toBe(true);
  }
});
it("a field choice can introduce an overlap and keeps unrelated semantic conflicts", () => {
  const clip = makeClip({ id: "a", assetId: "m", trackId: "v1", start: 0, inPoint: 0, duration: 1000, volume: 1 });
  const b = { ...emptyTimeline(), clips: { a: clip, b: { ...clip, id: "b", start: 3000 } } };
  const ours = applyOp(b, { type: "moveClip", clipId: "a", start: 1000 });
  const theirs = applyOp(b, { type: "moveClip", clipId: "a", start: 3000 });
  const r = mergeTimelines(b, ours, theirs);
  const resolved = resolveField(r, "a", "start", "theirs");
  expect(resolved.clean).toBe(false);
  expect(resolved.conflicts).toEqual([{ kind: "overlap", trackId: "v1", a: "a", b: "b", overlapStart: 3000, overlapEnd: 4000 }]);
  expect(conflictKey(resolved.conflicts[0]!)).toBe(conflictKey({ ...resolved.conflicts[0]!, kind: "overlap", trackId: "v1", a: "b", b: "a", overlapStart: 3000, overlapEnd: 4000 }));
});
