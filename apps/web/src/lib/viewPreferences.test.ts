import { describe, expect, it } from "vitest";
import { readViewPreferences, writeViewPreferences } from "./viewPreferences";

describe("local track preferences", () => {
  it("roundtrips hidden, muted and locked tracks", () => {
    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    const view = { hiddenTrackIds: ["v1"], mutedTrackIds: ["a1"], lockedTrackIds: ["v2"] };
    writeViewPreferences(storage, view);
    expect(readViewPreferences(storage)).toEqual(view);
  });
  it.each([null, "bad", "[]", "null", '{}', '{"hiddenTrackIds":[null]}'])("ignores malformed preferences %s", (raw) => {
    expect(readViewPreferences({ getItem: () => raw })).toBeNull();
  });
  it("does not fail when browser storage rejects access", () => {
    expect(readViewPreferences({getItem: () => { throw new Error("unavailable"); }})).toBeNull();
    expect(() => writeViewPreferences({setItem: () => { throw new Error("quota"); }}, {hiddenTrackIds:[], mutedTrackIds:[],lockedTrackIds:[]})).not.toThrow();
  });
});
