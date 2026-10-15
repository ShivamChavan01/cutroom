import { describe, expect, it } from "vitest";
import { buildActions, filterActions, type PaletteAction } from "./palette";

const actions: PaletteAction[] = [
  { id: "a", label: "Close gaps on all tracks", run: () => undefined },
  { id: "b", label: "Split selected clip at playhead", run: () => undefined },
  { id: "c", label: "Undo", run: () => undefined },
];

describe("filterActions", () => {
  it("returns everything on an empty query", () => {
    expect(filterActions(actions, "")).toHaveLength(3);
    expect(filterActions(actions, "   ")).toHaveLength(3);
  });

  it("matches case-insensitively", () => {
    expect(filterActions(actions, "UNDO").map((a) => a.id)).toEqual(["c"]);
  });

  it("matches non-contiguous subsequences", () => {
    expect(filterActions(actions, "clg").map((a) => a.id)).toEqual(["a"]);
    expect(filterActions(actions, "spli").map((a) => a.id)).toEqual(["b"]);
  });

  it("matches nothing unknown", () => {
    expect(filterActions(actions, "xyzzy")).toEqual([]);
  });

  it("every shipped action has a runnable run function", () => {
    for (const action of buildActions()) {
      expect(typeof action.run).toBe("function");
      expect(action.id.length).toBeGreaterThan(0);
      expect(action.label.length).toBeGreaterThan(0);
    }
    expect(buildActions().length).toBeGreaterThan(0);
  });
});
