import { create } from "zustand";
import { type MergeResult, mergeTimelines } from "@cutroom/engine";
import {
  type Repo,
  checkout,
  commit as commitToRepo,
  createBranch,
  createRepo,
  findMergeBase,
  head,
} from "./lib/vcs";
import { useEditorStore } from "./store";

export interface PendingMerge {
  readonly sourceBranch: string;
  readonly baseId: string;
  result: MergeResult;
}

interface VcsStore {
  readonly repo: Repo | null;
  readonly pending: PendingMerge | null;
  readonly ensureRepo: () => void;
  readonly commitCurrent: (message: string) => void;
  readonly createBranch: (name: string) => void;
  readonly checkoutBranch: (name: string) => void;
  readonly beginMerge: (sourceBranch: string) => void;
  readonly setResult: (result: MergeResult) => void;
  readonly cancelMerge: () => void;
  readonly commitMerge: (message: string) => void;
}

export const useVcsStore = create<VcsStore>()((set, get) => ({
  repo: null,
  pending: null,

  ensureRepo: () => {
    if (get().repo !== null) return;
    const editor = useEditorStore.getState();
    set({ repo: createRepo(editor.timeline, editor.authorId) });
  },

  commitCurrent: (message) => {
    const { repo } = get();
    if (repo === null) return;
    const editor = useEditorStore.getState();
    set({
      repo: commitToRepo(repo, editor.timeline, message, editor.authorId),
    });
  },

  createBranch: (name) => {
    const { repo } = get();
    if (repo === null) return;
    set({ repo: createBranch(repo, name) });
  },

  checkoutBranch: (name) => {
    const { repo } = get();
    if (repo === null) return;
    const next = checkout(repo, name);
    set({ repo: next, pending: null });
    useEditorStore.getState().loadTimeline(head(next).timeline);
  },

  beginMerge: (sourceBranch) => {
    const { repo } = get();
    if (repo === null || sourceBranch === repo.currentBranch) return;
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

  commitMerge: (message) => {
    const { repo, pending } = get();
    if (repo === null || pending === null || !pending.result.clean) return;
    const editor = useEditorStore.getState();
    const merged = commitToRepo(repo, pending.result.merged, message, editor.authorId, [
      head(repo).id,
      head(repo, pending.sourceBranch).id,
    ]);
    set({ repo: merged, pending: null });
    editor.loadTimeline(pending.result.merged);
  },
}));
