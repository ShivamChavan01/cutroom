import { afterEach, describe, expect, it } from "vitest";
import { emptyTimeline } from "@cutroom/engine";
import { ancestors, findMergeBase, findMergeBases, type Commit, type Repo } from "./vcs";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";

function history(parents: Readonly<Record<string, readonly string[]>>, a = "a", b = "b"): Repo {
  const timeline = emptyTimeline("merge-base");
  const commits: Record<string, Commit> = {};
  for (const [id, parentIds] of Object.entries(parents)) {
    commits[id] = { id, parents: parentIds, message: id, author: "editor", at: 0, timeline };
  }
  return { commits, branches: { main: a, feature: b }, currentBranch: "main", detachedAt: null };
}

function crisscross(): Repo {
  return history({ root: [], left: ["root"], right: ["root"], a: ["left", "right"], b: ["right", "left"] });
}

const initialVcs = useVcsStore.getState();
const initialEditor = useEditorStore.getState();
afterEach(() => {
  useVcsStore.setState(initialVcs, true);
  useEditorStore.setState(initialEditor, true);
});

describe("best common merge ancestors", () => {
  it("uses the newer shared ancestor even when BFS encounters its ancestor first", () => {
    const repo = history({ root: [], shared: ["root"], a: ["shared"], b: ["root", "shared"] });
    expect(findMergeBase(repo, "a", "b")?.id).toBe("shared");
    expect(findMergeBase(repo, "b", "a")?.id).toBe("shared");
    expect(findMergeBases(repo, "a", "b").map((commit) => commit.id)).toEqual(["shared"]);
  });

  it("returns every best criss-cross base and refuses an arbitrary single base", () => {
    const repo = crisscross();
    expect(findMergeBases(repo, "a", "b").map((commit) => commit.id)).toEqual(["left", "right"]);
    expect(() => findMergeBase(repo, "a", "b")).toThrow(/multiple merge bases.*left.*right.*not supported/i);
    expect(() => findMergeBase(repo, "b", "a")).toThrow(/multiple merge bases/);
  });

  it("does not depend on commit insertion order, parent order or wall-clock timestamps", () => {
    const repo = crisscross();
    const reordered = {
      ...repo,
      commits: Object.fromEntries(Object.entries(repo.commits).reverse().map(([id, commit], index) => [id, {
        ...commit, parents: [...commit.parents].reverse(), at: 100000 - index * 1000,
      }])),
    };
    expect(findMergeBases(reordered, "b", "a").map((commit) => commit.id)).toEqual(["left", "right"]);
    expect(() => findMergeBase(reordered, "b", "a")).toThrow(/multiple merge bases/);
  });

  it("prunes dominated common ancestors across multiple merges", () => {
    const repo = history({ root: [], older: ["root"], newer: ["older"], a: ["newer", "older"], b: ["older", "newer"] });
    expect(findMergeBases(repo, "a", "b").map((commit) => commit.id)).toEqual(["newer"]);
  });

  it("handles identical heads and either direction of ancestor merges", () => {
    const repo = history({ root: [], a: ["root"], b: ["a"] });
    expect(findMergeBase(repo, "b", "b")?.id).toBe("b");
    expect(findMergeBase(repo, "a", "b")?.id).toBe("a");
    expect(findMergeBase(repo, "b", "a")?.id).toBe("a");
  });

  it("returns null for unrelated and unknown heads and ignores missing ancestor references", () => {
    const repo = history({ a: ["missing"], b: ["missing"] });
    expect(findMergeBase(repo, "a", "b")).toBeNull();
    expect(findMergeBase(repo, "a", "unknown")).toBeNull();
    expect(findMergeBase(repo, "unknown", "unknown")).toBeNull();
    expect(findMergeBases(history({}), "a", "b")).toEqual([]);
    const pruned = history({ shared: ["missing"], a: ["shared"], b: ["shared"] });
    expect(findMergeBase(pruned, "a", "b")?.id).toBe("shared");
  });

  it("rejects cycles without recursive traversal or an unbounded ancestor search", () => {
    const repo = history({ a: ["b"], b: ["a"] });
    expect(ancestors(repo, "a")).toEqual(["a", "b"]);
    expect(() => findMergeBases(repo, "a", "b")).toThrow(/cycle/);
    expect(() => findMergeBase(history({ a: ["a"] }), "a", "a")).toThrow(/cycle/);
  });

  it("handles a deep history iteratively", () => {
    const parents = Object.fromEntries(Array.from({ length: 12000 }, (_, index) => [
      `c${index}`, index === 0 ? [] : [`c${index - 1}`],
    ]));
    expect(findMergeBase(history(parents, "c11999", "c6000"), "c11999", "c6000")?.id).toBe("c6000");
  });

  it("blocks an ambiguous merge without changing dirty editor state or publishing pending state", () => {
    const repo = crisscross();
    useVcsStore.setState({ repo, pending: null, diffOverlay: null });
    useEditorStore.getState().loadTimeline(emptyTimeline("uncommitted-working-copy"));
    useEditorStore.getState().dispatch({ type: "renameProject", name: "Unsaved edit" });
    const vcsBefore = useVcsStore.getState();
    const editorBefore = useEditorStore.getState();
    expect(() => vcsBefore.beginMerge("feature")).toThrow(/multiple merge bases/);
    expect(useVcsStore.getState()).toBe(vcsBefore);
    expect(useVcsStore.getState().repo).toBe(repo);
    expect(useVcsStore.getState().pending).toBeNull();
    expect(useEditorStore.getState()).toBe(editorBefore);
    expect(useEditorStore.getState().history).toBe(editorBefore.history);
    expect(useEditorStore.getState().timeline.id).toBe("Unsaved edit");
  });
});
