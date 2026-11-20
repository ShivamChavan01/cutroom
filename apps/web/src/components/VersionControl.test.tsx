import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline } from "@cutroom/engine";
import { createBranch, createRepo, viewCommit } from "../lib/vcs";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";
import { VersionControl } from "./VersionControl";

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

vi.mock("../store", async (original) => {
  const actual = await original<typeof import("../store")>();
  return { ...actual, useEditorStore: Object.assign(
    <T,>(select: (state: ReturnType<typeof actual.useEditorStore.getState>) => T) => select(actual.useEditorStore.getState()),
    {getState: actual.useEditorStore.getState}) };
});

describe("version control panel", () => {
  beforeEach(() => {
    const timeline = emptyTimeline("versions-test");
    useEditorStore.getState().loadTimeline(timeline);
    useVcsStore.setState({
      repo: createBranch(createRepo(timeline, "tester"), "alternate"),
      pending: null,
      diffOverlay: null,
    });
  });

  it("labels branch, comparison and merge controls in workflow order", () => {
    const html = renderToStaticMarkup(<VersionControl />);
    const labels = [...html.matchAll(/<select[^>]*aria-label="([^"]+)"/g)]
      .map((match) => match[1]);
    expect(labels).toEqual(["Compare from", "Compare to", "Merge source"]);
    expect(html).toContain("initial commit");
    expect(html).toContain("tester");
  });

  it("keeps commit and merge disabled until their required inputs are present", () => {
    const html = renderToStaticMarkup(<VersionControl />);
    expect(html).toContain("All changes saved · Latest save: initial commit");
    expect(html).not.toContain("What changed?");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Compare<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Merge<\/button>/);
    useEditorStore.getState().dispatch({type:"renameProject", name:"New edit"});
    const dirty = renderToStaticMarkup(<VersionControl />);
    expect(dirty).toContain("What changed?");
    expect(dirty).not.toContain("no change in problems");
    expect(dirty).toMatch(/<button[^>]*disabled=""[^>]*>Save version<\/button>/);
    expect(dirty).toContain("1 change since the last save");
  });

  it("keeps detached checkout status and the return action visible", () => {
    const repo = useVcsStore.getState().repo;
    if (repo === null) throw new Error("missing test repository");
    useVcsStore.setState({ repo: viewCommit(repo, "c0") });
    const html = renderToStaticMarkup(<VersionControl />);
    expect(html).toContain("Viewing saved version");
    expect(html).toContain("Return to main");
    expect(html).not.toContain('aria-label="Current branch"');
  });

  it("renders the initialization state without unavailable controls", () => {
    useVcsStore.setState({ repo: null });
    const html = renderToStaticMarkup(<VersionControl />);
    expect(html).toContain("Version control not initialized.");
    expect(html).not.toContain("<select");
  });
});
