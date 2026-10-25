import { create } from "zustand";
import {
  type Diff,
  type MergeResult,
  type Timeline,
  diffTimelines,
  mergeTimelines,
} from "@cutroom/engine";
import {
  type Repo,
  checkout,
  commit as commitToRepo,
  createBranch,
  createRepo,
  findMergeBase,
  head,
  viewCommit as viewCommitRepo,
} from "./lib/vcs";
import { useEditorStore } from "./store";

export interface PendingMerge {
  readonly sourceBranch: string;
  readonly baseId: string;
  result: MergeResult;
}

export interface DiffOverlay {
  readonly baseLabel: string;
  readonly targetLabel: string;
  readonly diff: Diff;
  /** The two timelines compared, so the panel can report the lint delta. */
  readonly base: Timeline;
  readonly target: Timeline;
}

interface VcsStore {
  readonly repo: Repo | null;
  readonly pending: PendingMerge | null;
  readonly diffOverlay: DiffOverlay | null;
  readonly ensureRepo: () => void;
  readonly commitCurrent: (message: string) => void;
  readonly createBranch: (name: string) => void;
  readonly forkBranch: (name: string) => void;
  readonly checkoutBranch: (name: string) => void;
  /** Check out a specific commit (detached HEAD) and show its timeline. */
  readonly viewCommit: (commitId: string) => void;
  readonly beginMerge: (sourceBranch: string) => void;
  readonly setResult: (result: MergeResult) => void;
  readonly cancelMerge: () => void;
  readonly commitMerge: (message: string) => void;
  readonly setDiff: (
    base: Timeline,
    baseLabel: string,
    target: Timeline,
    targetLabel: string,
  ) => void;
  readonly clearDiff: () => void;
  /** Restore a persisted repo (commits, branches, HEAD state). */
  readonly restoreRepo: (repo: Repo) => void;
}

export const useVcsStore = create<VcsStore>()((set, get) => ({
  repo: null,
  pending: null,
  diffOverlay: null,

  ensureRepo: () => {
    if (get().repo !== null) return;
    const editor = useEditorStore.getState();
    set({ repo: createRepo(editor.timeline, editor.authorId) });
  },

  commitCurrent: (message) => {
    const { repo } = get();
    if (repo === null) return;
    const editor = useEditorStore.getState();
    try {
      set({
        repo: commitToRepo(repo, editor.timeline, message, editor.authorId),
      });
    } catch {
      // Detached HEAD: committing is blocked (git behaves the same way —
      // you must pick a branch or name a new one first).
    }
  },

  createBranch: (name) => {
    const { repo } = get();
    if (repo === null) return;
    set({ repo: createBranch(repo, name) });
  },

  forkBranch: (name) => {
    const { repo } = get();
    if (repo === null) return;
    set({ repo: checkout(createBranch(repo, name), name), pending: null, diffOverlay: null });
  },

  checkoutBranch: (name) => {
    const { repo } = get();
    if (repo === null) return;
    const next = checkout(repo, name);
    set({ repo: next, pending: null, diffOverlay: null });
    useEditorStore.getState().loadTimeline(head(next).timeline);
  },

  viewCommit: (commitId) => {
    const { repo } = get();
    if (repo === null) return;
    const next = viewCommitRepo(repo, commitId);
    set({ repo: next, pending: null, diffOverlay: null });
    // Load the snapshot so the old version is actually watchable.
    const commit = next.commits[commitId];
    if (commit !== undefined) {
      useEditorStore.getState().loadTimeline(commit.timeline);
    }
  },

  beginMerge: (sourceBranch) => {
    const { repo } = get();
    if (repo === null || sourceBranch === repo.currentBranch) return;
    if (repo.detachedAt !== null) return; // merge from a branch, not a commit
    const editor = useEditorStore.getState();
    const ours = head(repo);
    const theirs = head(repo, sourceBranch);
    // Ours is the working timeline, not the head snapshot: merging takes
    // your uncommitted edits along. Committing first is cleaner; this is
    // friendlier. The commit message records which it was.
    const base = findMergeBase(repo, ours.id, theirs.id);
    if (base === null) throw new Error("vcs: no common ancestor");
    set({
      pending: {
        sourceBranch,
        baseId: base.id,
        result: mergeTimelines(base.timeline, editor.timeline, theirs.timeline),
      },
    });
  },

  setResult: (result) =>
    set((state) =>
      state.pending === null ? state : { pending: { ...state.pending, result } },
    ),

  cancelMerge: () => set({ pending: null }),

  setDiff: (base, baseLabel, target, targetLabel) =>
    set({
      diffOverlay: {
        baseLabel,
        targetLabel,
        diff: diffTimelines(base, target),
        base,
        target,
      },
    }),

  clearDiff: () => set({ diffOverlay: null }),

  restoreRepo: (repo) => set({ repo, pending: null, diffOverlay: null }),

  commitMerge: (message) => {
    const { repo, pending } = get();
    if (repo === null || pending === null || !pending.result.clean) return;
    const editor = useEditorStore.getState();
    const merged = commitToRepo(repo, pending.result.merged, message, editor.authorId, [
      head(repo).id,
      head(repo, pending.sourceBranch).id,
    ]);
    set({ repo: merged, pending: null, diffOverlay: null });
    editor.loadTimeline(pending.result.merged);
  },
}));
