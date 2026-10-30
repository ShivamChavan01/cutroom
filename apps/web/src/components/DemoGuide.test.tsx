import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DemoGuide } from "./DemoGuide";
import { useVcsStore } from "../vcsStore";
import { installDemoProject } from "../lib/demo/load";
import {conflictKey} from "@cutroom/engine";
import { TopBar } from "./TopBar";

vi.mock("../vcsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vcsStore")>();
  return {...actual, useVcsStore: Object.assign(<T,>(select: (state: ReturnType<typeof actual.useVcsStore.getState>) => T) => select(actual.useVcsStore.getState()), {getState: actual.useVcsStore.getState})};
});

vi.mock("../store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store")>();
  return {...actual, useEditorStore: Object.assign(<T,>(select: (state: ReturnType<typeof actual.useEditorStore.getState>) => T) => select(actual.useEditorStore.getState()), {getState: actual.useEditorStore.getState})};
});
describe("guided sample uses real VCS state", () => {
  beforeEach(() => installDemoProject());
  it("begins with an optional guide and opens the sample in a separate tab", () => {
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("Explore different edits without losing your work");
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("Skip guide");
    expect(renderToStaticMarkup(<TopBar />)).toContain('href="?demo=1" target="_blank" rel="noopener noreferrer"');
  });
  it("shows a genuine conflict, then engine-confirmed resolution, then verification", () => {
    const vcs = useVcsStore.getState();
    vcs.beginMerge("alternate");
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("Both edits need the same moment");
    expect(renderToStaticMarkup(<DemoGuide />)).not.toContain("Your choice is recorded");
    const result = useVcsStore.getState().pending!.result;
    const conflict = result.conflicts[0]!;
    if (conflict.kind !== "overlap") throw new Error("Sample must have an overlap");
    vcs.resolveConflict(conflictKey(conflict), "a");
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("Your choice is recorded");
    vcs.commitMerge("Resolve sample conflict");
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("Review the combined cut");
    expect(renderToStaticMarkup(<DemoGuide />)).not.toContain("Pending merges are not saved");
  });
});
