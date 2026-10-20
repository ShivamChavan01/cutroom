import { describe, expect, it } from "vitest";
import { parseLayout, readLayout, writeLayout } from "./layout";

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

  it("keeps only positive finite numbers", () => {
    expect(parseLayout('{"a":10,"b":0,"c":-2,"d":"x","e":3.5}')).toEqual({
      a: 10,
      e: 3.5,
    });
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
