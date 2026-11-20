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
// Version one clients write unconditionally. Upgrading fences those writers
// without changing the projects store or its serialized data.
export const DB_VERSION = 2;
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
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {db.close(); return;}
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("could not open IndexedDB"));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("IndexedDB is blocked by another tab. Close other Cutroom tabs, then reload to restore your saved project."));
    };
  });
}

interface ProjectSlot {
  expected: string | undefined;
  tail: Promise<void>;
}

// Each tab remembers only its last observed durable value. IndexedDB remains
// authoritative; comparison and replacement happen in one readwrite transaction.
const slots = new Map<string, ProjectSlot>();

function inOrder<T>(key: string, operation: (slot: ProjectSlot) => Promise<StorageResult<T>>): Promise<StorageResult<T>> {
  let slot = slots.get(key);
  if (slot === undefined) {
    slot = {expected: undefined, tail: Promise.resolve()};
    slots.set(key, slot);
  }
  const current = slot;
  const result = current.tail.then(() => operation(current));
  // Keep the queue usable after a failure; the caller still receives result.
  current.tail = result.then(() => undefined, () => undefined);
  return result;
}

function storageFailure(error: unknown): StorageResult<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "unknown storage error",
    status: isStorageAvailable() ? "error" : "unavailable",
  };
}

export function readProject(key = workspaceKey(PROJECT_KEY)): Promise<StorageResult<string | undefined>> {
  return inOrder(key, async slot => {
    try {
      const db = await openDatabase();
      try {
        const value = await new Promise<string | undefined>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const request = tx.objectStore(STORE_NAME).get(key);
          let value: string | undefined;
          request.onsuccess = () => {
            const stored: unknown = request.result;
            if (stored !== undefined && typeof stored !== "string") {
              reject(new Error("The stored project is not text. Export or recover it before resetting."));
              return;
            }
            value = stored;
          };
          tx.oncomplete = () => resolve(value);
          tx.onerror = () => reject(tx.error ?? new Error("could not read the project"));
          tx.onabort = () => reject(tx.error ?? new Error("the project read was aborted"));
        });
        slot.expected = value;
        return {ok: true, value, status: "ok"};
      } finally {db.close();}
    } catch (error) {return storageFailure(error);}
  });
}

async function replaceProject(slot: ProjectSlot, key: string, value: string | undefined): Promise<StorageResult<boolean>> {
  try {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);
        let stale = false;
        let failure: unknown;
        request.onsuccess = () => {
          // Exact equality also makes repeated identical initialization safe.
          if (request.result === value) return;
          if (request.result !== slot.expected) {
            stale = true;
            tx.abort();
            return;
          }
          try {
            if (value === undefined) store.delete(key);
            else store.put(value, key);
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("could not save the project"));
        tx.onabort = () => reject(stale
          ? new Error("Another tab changed this workspace. Your edits remain in this tab. Export your timeline before reloading; this tab cannot overwrite the newer saved project.")
          : failure ?? tx.error ?? new Error("the project write was aborted (quota?)"));
      });
      slot.expected = value;
      return {ok: true, value: true, status: "ok"};
    } finally {db.close();}
  } catch (error) {return storageFailure(error);}
}

export function writeProject(serialized: string, key = workspaceKey(PROJECT_KEY)): Promise<StorageResult<boolean>> {
  return inOrder(key, slot => replaceProject(slot, key, serialized));
}

export function clearProject(key = workspaceKey(PROJECT_KEY)): Promise<StorageResult<boolean>> {
  return inOrder(key, slot => replaceProject(slot, key, undefined));
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
