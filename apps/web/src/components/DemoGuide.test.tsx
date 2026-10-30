import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DemoGuide } from "./DemoGuide";
import { useVcsStore } from "../vcsStore";
import { installDemoProject } from "../lib/demo/load";
import { resolveOverlap } from "../lib/vcs";
import { TopBar } from "./TopBar";

vi.mock("../vcsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vcsStore")>();
  return {...actual, useVcsStore: Object.assign(<T,>(select: (state: ReturnType<typeof actual.useVcsStore.getState>) => T) => select(actual.useVcsStore.getState()), {getState: actual.useVcsStore.getState})};
});

describe("guided sample uses real VCS state", () => {
  beforeEach(() => installDemoProject());
  it("begins with an optional guide and opens the sample in a separate tab", () => {
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("A timeline you can version");
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("Skip guide");
    expect(renderToStaticMarkup(<TopBar />)).toContain('href="?demo=1" target="_blank" rel="noopener noreferrer"');
  });
  it("shows a genuine conflict, then engine-confirmed resolution, then verification", () => {
    const vcs = useVcsStore.getState();
    vcs.beginMerge("alternate");
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("Independent edits collide");
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("Pending merges are not saved");
    const result = useVcsStore.getState().pending!.result;
    const conflict = result.conflicts[0]!;
    if (conflict.kind !== "overlap") throw new Error("Sample must have an overlap");
    vcs.setResult(resolveOverlap(result, conflict.a, conflict.b));
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("Your timing decision is recorded");
    vcs.commitMerge("Resolve sample conflict");
    expect(renderToStaticMarkup(<DemoGuide />)).toContain("Merged does not mean verified");
    expect(renderToStaticMarkup(<DemoGuide />)).not.toContain("Pending merges are not saved");
  });
});
