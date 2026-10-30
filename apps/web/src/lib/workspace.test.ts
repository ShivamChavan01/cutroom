import { describe, expect, it, vi, afterEach } from "vitest";
import { demoHref, isDemoWorkspace, workspaceKey } from "./workspace";
import { readViewPreferences, writeViewPreferences, VIEW_PREFERENCES_KEY } from "./viewPreferences";
import { readLayout, writeLayout } from "./layout";

afterEach(() => vi.unstubAllGlobals());
describe("isolated demo workspace", () => {
  it("requires the explicit demo flag and keeps ordinary URLs personal", () => {
    for (const search of ["", "?demo=0", "?demo=true", "?project=demo"]) expect(isDemoWorkspace(search)).toBe(false);
    expect(isDemoWorkspace(demoHref())).toBe(true);
    expect(workspaceKey("current", "")).toBe("current");
    expect(workspaceKey("current", "?demo=1")).toBe("current.demo-v1");
  });
  it("keeps track preferences and resizing out of the personal workspace", () => {
    const data = new Map<string, string>();
    const storage = {getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }};
    const personal = {hiddenTrackIds: ["v1"], mutedTrackIds: [], lockedTrackIds: []};
    writeViewPreferences(storage, personal);
    writeLayout(storage, "editor", {a: 60, b: 40});
    vi.stubGlobal("location", {search: "?demo=1"});
    expect(readViewPreferences(storage)).toBeNull();
    expect(readLayout(storage, "editor")).toBeNull();
    writeViewPreferences(storage, {...personal, hiddenTrackIds: []});
    writeLayout(storage, "editor", {a: 50, b: 50});
    expect(data.get(VIEW_PREFERENCES_KEY)).toBe(JSON.stringify(personal));
    vi.stubGlobal("location", {search: ""});
    expect(readLayout(storage, "editor")).toEqual({a: 60, b: 40});
    expect(readViewPreferences(storage)).toEqual(personal);
  });
});
