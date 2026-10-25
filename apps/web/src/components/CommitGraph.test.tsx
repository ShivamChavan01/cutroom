import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline } from "@cutroom/engine";
import { checkout, commit, createBranch, createRepo } from "../lib/vcs";
import { useVcsStore } from "../vcsStore";
import { CommitGraph } from "./CommitGraph";

vi.mock("../vcsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vcsStore")>();
  return {
    ...actual,
    useVcsStore: Object.assign(
      <T,>(selector: (state: ReturnType<typeof actual.useVcsStore.getState>) => T) => selector(actual.useVcsStore.getState()),
      { getState: actual.useVcsStore.getState, setState: actual.useVcsStore.setState },
    ),
  };
});

beforeEach(() => {
  const timeline = emptyTimeline("graph");
  let repo = commit(createRepo(timeline, "alice"), timeline, "base work", "alice");
  repo = checkout(createBranch(repo, "twovideos"), "twovideos");
  repo = commit(repo, timeline, "trim second video", "alice");
  useVcsStore.setState({ repo });
});

it("renders the checked-out feature beside main, with a fork and HEAD label", () => {
  const html = renderToStaticMarkup(<CommitGraph />);
  expect(html).toContain('data-commit-id="c2" data-lane="1"');
  expect(html).toContain('data-commit-id="c1" data-lane="0"');
  expect(html).toContain("twovideos · HEAD");
  expect(html).toContain("<path");
  expect(html).toContain("Main stays on the left");
});

it("handles an uninitialized repository", () => {
  useVcsStore.setState({ repo: null });
  expect(renderToStaticMarkup(<CommitGraph />)).toContain("Version control not initialized.");
});
