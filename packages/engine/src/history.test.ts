import { describe, expect, it } from "vitest";
import {
  applyOps,
  authorsByClip,
  canRedo,
  canUndo,
  createHistory,
  current,
  diffTimelines,
  isUnchanged,
  makeClip,
  record,
  redo,
  splitChildId,
  undo,
} from "./index";
import { baseTimeline } from "./fixtures.js";

describe("history", () => {
  it("replays the log to produce current state", () => {
    const h = record(createHistory(baseTimeline()), {
      type: "moveClip",
      clipId: "c1",
      start: 3_000,
    }, "alice");

    expect(current(h).clips.c1?.start).toBe(3_000);
  });

  it("undoes and redoes by moving the cursor, not by popping the log", () => {
    let h = createHistory(baseTimeline());
    h = record(h, { type: "moveClip", clipId: "c1", start: 3_000 }, "alice");
    h = record(h, { type: "setVolume", clipId: "c1", volume: 0.25 }, "alice");

    expect(current(h).clips.c1).toMatchObject({ start: 3_000, volume: 0.25 });

    h = undo(h);
    expect(current(h).clips.c1).toMatchObject({ start: 3_000, volume: 1 });

    h = undo(h);
    expect(current(h).clips.c1?.start).toBe(0);

    h = redo(h);
    h = redo(h);
    expect(current(h).clips.c1).toMatchObject({ start: 3_000, volume: 0.25 });
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it("discards the abandoned future when recording after an undo", () => {
    let h = createHistory(baseTimeline());
    h = record(h, { type: "moveClip", clipId: "c1", start: 3_000 }, "alice");
    h = record(h, { type: "moveClip", clipId: "c1", start: 4_000 }, "alice");
    h = undo(h);

    h = record(h, { type: "setVolume", clipId: "c1", volume: 0.5 }, "bob");

    expect(canRedo(h)).toBe(false);
    expect(current(h).clips.c1).toMatchObject({ start: 3_000, volume: 0.5 });
  });

  it("attributes a clip to the author who added it", () => {
    let h = createHistory(baseTimeline());
    h = record(h, { type: "moveClip", clipId: "c1", start: 1_000 }, "alice");
    expect(authorsByClip(h).get("c1")).toBe("alice");
  });

  it("credits split children to whoever split the parent", () => {
    let h = createHistory(baseTimeline());
    h = record(h, { type: "splitClip", clipId: "c1", at: 4_000 }, "bob");

    const authors = authorsByClip(h);
    for (const clip of Object.values(current(h).clips)) {
      expect(authors.get(clip.id)).toBe("bob");
    }
  });

  it("attributes working edits to the latest applied clip operation through Undo/Redo", () => {
    let h = record(createHistory(baseTimeline()), {type: "moveClip", clipId: "c1", start: 1000}, "alice");
    h = record(h, {type: "setVolume", clipId: "c1", volume: .5}, "bob");
    expect(authorsByClip(h).get("c1")).toBe("bob");
    expect(authorsByClip(undo(h)).get("c1")).toBe("alice");
    expect(authorsByClip(redo(undo(h))).get("c1")).toBe("bob");
  });

  it("drops blame for a deleted clip", () => {
    let h = createHistory(baseTimeline());
    h = record(h, { type: "deleteClip", clipId: "c1" }, "alice");
    expect(authorsByClip(h).has("c1")).toBe(false);
  });

  it("uses an already-derived snapshot with the same split, deletion and cursor authorship", () => {
    let h = createHistory(baseTimeline());
    const root = h;
    h = record(h, { type: "setVolume", clipId: "c1", volume: 0.5 }, "alice");
    const edited = h;
    h = record(h, { type: "splitClip", clipId: "c1", at: 4_000 }, "bob");
    const split = h;
    const left = splitChildId("c1", 4_000, "L");
    const right = splitChildId("c1", 4_000, "R");
    h = record(h, { type: "splitClip", clipId: left, at: 2_000 }, "charlie");
    const nested = h;
    const nestedLeft = splitChildId(left, 2_000, "L");
    const nestedRight = splitChildId(left, 2_000, "R");
    const descendants = authorsByClip(nested, current(nested));
    expect(descendants.get(nestedLeft)).toBe("charlie");
    expect(descendants.get(nestedRight)).toBe("charlie");
    expect(descendants.get(right)).toBe("bob");
    h = record(h, { type: "deleteClip", clipId: left }, "dave");
    const deleted = authorsByClip(h, current(h));
    expect([...deleted.keys()]).toEqual([right]);
    expect(deleted.get(right)).toBe("bob");
    for (const history of [root, edited, split, nested, h, undo(h), redo(undo(h))]) {
      expect(authorsByClip(history, current(history))).toEqual(authorsByClip(history));
    }
    expect(authorsByClip(root, current(root)).size).toBe(0);
  });
});

describe("diff", () => {
  it("reports no changes for identical timelines", () => {
    const base = baseTimeline();
    const diff = diffTimelines(base, base);
    expect(diff.changes).toEqual([]);
    expect(diff.unchanged).toBe(1);
    expect(isUnchanged(base, base)).toBe(true);
  });

  it("reports a move as a move, not as an unrelated delete plus add", () => {
    // The reason clips are keyed by identity rather than position.
    const base = baseTimeline();
    const after = record(createHistory(base), {
      type: "moveClip",
      clipId: "c1",
      start: 5_000,
    }, "alice");

    const diff = diffTimelines(base, current(after));

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]?.kind).toBe("moved");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  it("distinguishes a trim from a move", () => {
    const base = baseTimeline();
    const after = record(createHistory(base), {
      type: "trimClip",
      clipId: "c1",
      inPoint: 1_000,
      duration: 5_000,
    }, "alice");

    const diff = diffTimelines(base, current(after));
    expect(diff.changes[0]?.kind).toBe("trimmed");
    if (diff.changes[0]?.kind === "trimmed") {
      expect(diff.changes[0].deltaIn).toBe(1_000);
      expect(diff.changes[0].deltaDuration).toBe(-5_000);
    }
  });

  it("does not report a phantom change for the derived outPoint field", () => {
    const base = baseTimeline();
    const after = record(createHistory(base), {
      type: "setVolume",
      clipId: "c1",
      volume: 0.5,
    }, "alice");

    const diff = diffTimelines(base, current(after));
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]?.kind).toBe("edited");
    if (diff.changes[0]?.kind === "edited") {
      expect(diff.changes[0].fields).toEqual(["volume"]);
    }
  });

  it("counts additions and removals", () => {
    const base = baseTimeline();
    const after = applyOps(base, [
      { type: "deleteClip", clipId: "c1" },
      {
        type: "addClip",
        clip: makeClip({
          id: "new",
          trackId: "v1",
          assetId: "asset-a",
          start: 0,
          inPoint: 0,
          duration: 2_000,
          volume: 1,
        }),
      },
    ]);

    const diff = diffTimelines(base, after);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.changed).toBe(0);
  });
});
