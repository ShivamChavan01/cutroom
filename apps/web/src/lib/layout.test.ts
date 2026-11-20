import { describe, expect, it } from "vitest";
import { layoutForPanels, parseLayout, readLayout, writeLayout } from "./layout";

describe("layout persistence", () => {
  it("round-trips a layout through storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    writeLayout(storage, "main", { rail: 20, centre: 60 });
    expect(readLayout(storage, "main")).toEqual({ rail: 20, centre: 60 });
  });

  it("returns null for missing or malformed data", () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout("not json")).toBeNull();
    expect(parseLayout("[1,2]")).toBeNull();
    expect(parseLayout("{}")).toBeNull();
    expect(parseLayout('{"a":"x"}')).toBeNull();
    expect(parseLayout('{"a":-1}')).toBeNull();
  });

  it("retains collapsed panels and rejects negative or nonnumeric sizes", () => {
    expect(parseLayout('{"a":10,"b":0,"c":-2,"d":"x","e":3.5}')).toEqual({
      a: 10,
      b: 0,
      e: 3.5,
    });
  });

  it("restores only complete normalized layouts and keeps edit and agent sizes independent", () => {
    const fallback = { library: 52, viewer: 48, properties: 0 };
    expect(layoutForPanels({ library: 55, viewer: 45, properties: 0 }, Object.keys(fallback), fallback)).toEqual({ library: 55, viewer: 45, properties: 0 });
    for (const invalid of [null, { library: 60 }, { library: 80, viewer: 40, properties: 0 }, { library: 0, viewer: 0, properties: 0 }]) {
      expect(layoutForPanels(invalid, Object.keys(fallback), fallback)).toBe(fallback);
    }
    expect(readLayout({ getItem: () => { throw new Error("Storage blocked"); } }, "agent")).toBeNull();
  });

  it("survives storage that throws", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeLayout(storage, "main", { a: 1 })).not.toThrow();
  });
});
