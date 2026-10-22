import { create } from "zustand";

/**
 * Persistence state, kept in its own store so the status bar can read it
 * without prop drilling and so a storage problem is visible everywhere it
 * matters — never a silent failure.
 */
export type PersistStatus =
  /** Nothing stored yet, nothing to save. */
  | "idle"
  /** There are changes not yet written. */
  | "unsaved"
  /** A write is in flight. */
  | "saving"
  /** Everything is on disk. */
  | "saved"
  /** Storage is not available at all — running in memory only. */
  | "unavailable"
  /** Storage failed (quota, permissions, corrupt data). */
  | "error";

export interface LoadFailure {
  readonly message: string;
  /** The raw stored text, so the user can export it before a reset. */
  readonly raw: string;
}

interface PersistenceStore {
  readonly status: PersistStatus;
  readonly message: string | null;
  readonly loadFailure: LoadFailure | null;
  readonly usage: { usage: number | null; quota: number | null } | null;
  readonly setStatus: (status: PersistStatus, message?: string | null) => void;
  readonly setLoadFailure: (failure: LoadFailure | null) => void;
  readonly setUsage: (usage: { usage: number | null; quota: number | null }) => void;
}

export const usePersistenceStore = create<PersistenceStore>()((set) => ({
  status: "idle",
  message: null,
  loadFailure: null,
  usage: null,
  setStatus: (status, message = null) => set({ status, message }),
  setLoadFailure: (loadFailure) => set({ loadFailure }),
  setUsage: (usage) => set({ usage }),
}));
