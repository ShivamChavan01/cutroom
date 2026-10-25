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
    expect(labels).toEqual(["Current branch", "Compare from", "Compare to", "Merge source"]);
    expect(html).toContain("initial commit");
    expect(html).toContain("tester");
  });

  it("keeps commit and merge disabled until their required inputs are present", () => {
    const html = renderToStaticMarkup(<VersionControl />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Commit<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Merge<\/button>/);
    expect(html).toContain('placeholder="new branch"');
    expect(html).toContain('placeholder="commit message"');
  });

  it("keeps detached checkout status and the return action visible", () => {
    const repo = useVcsStore.getState().repo;
    if (repo === null) throw new Error("missing test repository");
    useVcsStore.setState({ repo: viewCommit(repo, "c0") });
    const html = renderToStaticMarkup(<VersionControl />);
    expect(html).toContain("detached at c0");
    expect(html).toContain("back to main");
    expect(html).not.toContain('aria-label="Current branch"');
  });

  it("renders the initialization state without unavailable controls", () => {
    useVcsStore.setState({ repo: null });
    const html = renderToStaticMarkup(<VersionControl />);
    expect(html).toContain("Version control not initialized.");
    expect(html).not.toContain("<select");
  });
});
