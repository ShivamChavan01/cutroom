import { workspaceKey } from "../workspace";

/**
 * The storage half: IndexedDB, with a graceful path when it is not there.
 *
 * Two rules this layer follows, because both failure modes are invisible
 * otherwise:
 *   1. Availability is *detected*, never assumed. A browser in private
 *      mode, a denied permission, a locked-down environment — all of them
 *      must degrade to memory with a visible warning, not to a silent
 *      no-op that loses the user's work silently.
 *   2. A failed write never throws into the editor. Storage problems are
 *      reported as state, not exceptions, so a quota error cannot take the
 *      app down mid-edit.
 */

export const DB_NAME = "cutroom";
export const DB_VERSION = 1;
export const STORE_NAME = "projects";
export const PROJECT_KEY = "current";

export type StorageStatus = "ok" | "unavailable" | "error";

export interface StorageResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: string;
  readonly status: StorageStatus;
}

function indexedDBFactory(): IDBFactory | null {
  try {
    if (typeof indexedDB === "undefined") return null;
    // Opening a database can throw outright in some locked-down contexts.
    return indexedDB;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return indexedDBFactory() !== null;
}

function openDatabase(): Promise<IDBDatabase> {
  const factory = indexedDBFactory();
  if (factory === null) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("could not open IndexedDB"));
    request.onblocked = () =>
      reject(new Error("IndexedDB is blocked by another tab"));
  });
}

export async function readProject(key = workspaceKey(PROJECT_KEY)): Promise<StorageResult<string | undefined>> {
  try {
    const db = await openDatabase();
    try {
      const value = await new Promise<string | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result as string | undefined);
        request.onerror = () =>
          reject(request.error ?? new Error("could not read the project"));
      });
      return { ok: true, value, status: "ok" };
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      ok: false,
      error: message,
      status: isStorageAvailable() ? "error" : "unavailable",
    };
  }
}

export async function writeProject(serialized: string, key = workspaceKey(PROJECT_KEY)): Promise<StorageResult<boolean>> {
  try {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(serialized, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error("could not write the project"));
        tx.onabort = () =>
          reject(tx.error ?? new Error("the write was aborted (quota?)"));
      });
      return { ok: true, value: true, status: "ok" };
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      ok: false,
      error: message,
      status: isStorageAvailable() ? "error" : "unavailable",
    };
  }
}

export async function clearProject(key = workspaceKey(PROJECT_KEY)): Promise<StorageResult<boolean>> {
  try {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error("could not clear the project"));
      });
      return { ok: true, value: true, status: "ok" };
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      ok: false,
      error: message,
      status: isStorageAvailable() ? "error" : "unavailable",
    };
  }
}

/** How much room is left, if the browser will tell us. */
export interface StorageUsage {
  readonly usage: number | null;
  readonly quota: number | null;
}

export async function storageUsage(): Promise<StorageUsage> {
  try {
    if (typeof navigator === "undefined" || navigator.storage === undefined) {
      return { usage: null, quota: null };
    }
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}
