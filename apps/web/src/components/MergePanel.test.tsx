import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline, mergeTimelines } from "@cutroom/engine";
import { checkout, createBranch, createRepo } from "../lib/vcs";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";
import { MergePanel } from "./MergePanel";

vi.mock("../vcsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vcsStore")>();
  return {
    ...actual,
    useVcsStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useVcsStore.getState>) => T) =>
        selector(actual.useVcsStore.getState()),
      { getState: actual.useVcsStore.getState, setState: actual.useVcsStore.setState },
    ),
  };
});

function renderedText(): string {
  return renderToStaticMarkup(<MergePanel />)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ");
}

describe("merge panel", () => {
  beforeEach(() => {
    const timeline = emptyTimeline("merge-panel-test");
    useEditorStore.getState().loadTimeline(timeline);
    useVcsStore.setState({ repo: createRepo(timeline, "tester"), pending: null });
  });

  it.each(["main", "release"])(
    "names the source and checked-out destination %s separately",
    (destination) => {
      const timeline = useEditorStore.getState().timeline;
      let repo = createBranch(createRepo(timeline, "tester"), "alternate");
      if (destination !== "main") {
        repo = checkout(createBranch(repo, destination), destination);
      }
      useVcsStore.setState({
        repo,
        pending: {
          sourceBranch: "alternate",
          baseId: "c0", workingTimeline: useEditorStore.getState().timeline, oursId: "c0", theirsId: "c0",
          result: mergeTimelines(timeline, timeline, timeline),
        },
      });

      expect(renderedText()).toContain(`Merging alternate into ${destination}`);
    },
  );

  it("explains how to start when no merge is pending", () => {
    expect(renderedText()).toContain("No merge in progress.");
    expect(renderedText()).not.toContain("Commit merge");
  });

  it("offers explicit choices for conflicting project settings", () => {
    const base = useEditorStore.getState().timeline;
    useVcsStore.setState({ pending: {
      sourceBranch: "alternate",
      baseId: "c0", workingTimeline: useEditorStore.getState().timeline, oursId: "c0", theirsId: "c0",
      result: mergeTimelines(base, { ...base, fps: 25 }, { ...base, fps: 24 }),
    } });
    expect(renderedText()).toContain("Project fps: 25 / 24");
    expect(renderedText()).toContain("Keep ours");
    expect(renderedText()).toContain("Take theirs");
  });
});

 it("shows every metadata resolution kind without inventing timeline bands", () => {
  const base = { ...emptyTimeline(), assets: { media: { id: "media", kind: "video" as const, duration: 1000, name: "base" } } };
  const ours = { ...base, assets: { media: { ...base.assets.media, name: "ours" } }, tracks: base.tracks.map(t => ({ ...t, name: "ours" })) };
  const theirs = { ...base, assets: { media: { ...base.assets.media, name: "theirs" } }, tracks: base.tracks.map(t => ({ ...t, name: "theirs" })) };
  useVcsStore.setState({ pending: { sourceBranch: "alternate", baseId: "c0", workingTimeline: ours, oursId: "c0", theirsId: "c0", result: mergeTimelines(base, ours, theirs) } });
  expect(renderedText()).toContain("Asset media.name");
  expect(renderedText()).toContain("Track v1.name");
  expect(renderedText()).toContain("Take theirs");
 });
