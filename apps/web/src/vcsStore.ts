import {restoreMedia} from "./lib/persistence/restoreMedia";
import {useAssetUrls} from "./lib/assets";
import {usePersistenceStore} from "./lib/persistence/persistenceStore";
import {assertMergeCurrent, prepareMerge, recordResolution, type PendingMerge, type MergeChoice} from "./lib/mergeSession";
export type {PendingMerge} from "./lib/mergeSession";
import { create } from "zustand";
import {
  type Diff,
  type Timeline,
  diffTimelines,
  refreshMergeConflicts,
  isUnchanged,
} from "@cutroom/engine";
import {
  type Repo,
  currentCommit,
  checkout,
  commit as commitToRepo,
  createBranch,
  createRepo,
  head,
  viewCommit as viewCommitRepo,
} from "./lib/vcs";
import { useEditorStore } from "./store";

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
  readonly beginMerge: (sourceBranch: string) => "pending" | "up-to-date" | "fast-forward";
  readonly resolveConflict: (key: string, choice: MergeChoice) => void;
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
  readonly restoreRepo: (repo: Repo, pending?: PendingMerge | null) => void;
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
    const { repo, pending } = get();
    if (repo === null) throw new Error("Initialize version control before committing.");
    if (pending !== null) throw new Error("Finish or cancel the merge before committing.");
    const editor = useEditorStore.getState();
    set({ repo: commitToRepo(repo, editor.timeline, message, editor.authorId) });
  },

  createBranch: (name) => {
    const { repo } = get();
    if (repo === null) return;
    set({ repo: createBranch(repo, name) });
  },

  forkBranch: (name) => {
    const { repo } = get();
    if (repo === null) return;
    if (get().pending !== null) throw new Error("Finish or cancel the merge before creating a version.");
    set({ repo: checkout(createBranch(repo, name), name), pending: null, diffOverlay: null });
  },

  checkoutBranch: (name) => {
    const { repo } = get();
    if (repo === null) return;
    if (get().pending !== null) throw new Error("Finish or cancel the merge before checkout.");
    if (repo.detachedAt === null && repo.currentBranch === name) return;
    requireCleanWorkingTree(repo);
    const next = checkout(repo, name);
    set({ repo: next, pending: null, diffOverlay: null });
    loadVersionTimeline(head(next).timeline);
  },

  viewCommit: (commitId) => {
    const { repo } = get();
    if (repo === null) return;
    if (get().pending !== null) throw new Error("Finish or cancel the merge before viewing a commit.");
    requireCleanWorkingTree(repo);
    const next = viewCommitRepo(repo, commitId);
    set({ repo: next, pending: null, diffOverlay: null });
    // Load the snapshot so the old version is actually watchable.
    const commit = next.commits[commitId];
    if (commit !== undefined) {
      loadVersionTimeline(commit.timeline);
    }
  },

  beginMerge: (sourceBranch) => {
    const {repo, pending} = get();
    if (repo === null) throw new Error("Initialize version control before merging.");
    if (pending !== null) throw new Error("Finish or cancel the current merge first.");
    const entry = prepareMerge(repo, useEditorStore.getState().timeline, sourceBranch);
    if (entry.kind === "up-to-date") return entry.kind;
    if (entry.kind === "fast-forward") {
      set({repo: {...repo, branches: {...repo.branches, [repo.currentBranch]: entry.source.id}}, pending: null, diffOverlay: null});
      loadVersionTimeline(entry.source.timeline);
    } else set({pending: entry.pending});
    return entry.kind;
  },

  resolveConflict: (key, choice) => {
    const {repo, pending} = get();
    if (pending === null || repo === null) throw new Error("No merge is in progress.");
    assertMergeCurrent(pending, repo, useEditorStore.getState().timeline);
    set({pending: recordResolution(pending, {key, choice})});
  },

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

  restoreRepo: (repo, pending = null) => set({ repo, pending, diffOverlay: null }),

  commitMerge: (message) => {
    const { repo, pending } = get();
    if (repo === null || pending === null) throw new Error("No merge is in progress.");
    const result = refreshMergeConflicts(pending.result);
    if (!result.clean) throw new Error("Resolve all conflicts before committing the merge.");
    const editor = useEditorStore.getState();
    assertMergeCurrent(pending, repo, editor.timeline);
    const merged = commitToRepo(repo, result.merged, message, editor.authorId, [pending.oursId, pending.theirsId]);
    set({ repo: merged, pending: null, diffOverlay: null });
    loadVersionTimeline(result.merged);
  },
}));

function requireCleanWorkingTree(repo: Repo): void {
  if (!isUnchanged(currentCommit(repo).timeline, useEditorStore.getState().timeline)) {
    throw new Error("You have uncommitted changes. Commit them or create a new version before checkout.");
  }
}

/** New branch snapshots may reference local sources absent from the current bin. */
function loadVersionTimeline(timeline: Timeline): void {
  useEditorStore.getState().loadTimeline(timeline);
  void restoreMedia(timeline, undefined, useAssetUrls.getState()).then(media => {
    if (useEditorStore.getState().timeline === timeline) usePersistenceStore.getState().setMediaWarning(media.warning);
  }).catch((error: unknown) => {
    if (useEditorStore.getState().timeline === timeline) usePersistenceStore.getState().setMediaWarning(error instanceof Error ? error.message : "Could not restore this version's media.");
  });
}
