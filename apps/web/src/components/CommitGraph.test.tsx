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
  expect(html.replace(/<[^>]*>/g, "")).toContain("twovideos · HEAD");
  expect(html).toContain("<path");
  expect(html).toContain("Main stays on the left");
});

it("handles an uninitialized repository", () => {
  useVcsStore.setState({ repo: null });
  expect(renderToStaticMarkup(<CommitGraph />)).toContain("Version control not initialized.");
});


it("explains shared tips without inventing another history lane", () => {
  const repo = useVcsStore.getState().repo!;
  useVcsStore.setState({ repo: { ...repo, branches: { ...repo.branches, alternate: "c2", backup: "c2" } } });
  const html = renderToStaticMarkup(<CommitGraph />);
  expect(html).toContain("Shared tip");
  expect(html).toContain("+1 branches");
  expect(html).toContain("4 branches · 3 commits");
  expect(html.match(/<circle /g)).toHaveLength(3);
});

it("marks merge commits and detached HEAD separately from branch pointers", () => {
  const repo = useVcsStore.getState().repo!;
  const parent = repo.commits.c2!;
  useVcsStore.setState({ repo: {
    ...repo, detachedAt: "c1", branches: { ...repo.branches, main: "c3" },
    commits: { ...repo.commits, c3: { ...parent, id: "c3", message: "Merge twovideos", parents: ["c1", "c2"] } },
  } });
  const html = renderToStaticMarkup(<CommitGraph />);
  expect(html).toContain('title="Parents: c1 + c2"');
  expect(html).toContain('data-edge-kind="merge" data-from="c3" data-to="c2"');
  expect(html).toMatch(/d="M 14 44 C 14 66 36 66 36 88 V/);
  expect(html).toContain("Viewing · HEAD");
  expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  expect(html).not.toContain("main · HEAD");
});
