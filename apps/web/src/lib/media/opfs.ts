import { workspaceKey } from "../workspace";

/**
 * Media storage in OPFS (Origin Private File System), keyed by the asset's
 * content hash.
 *
 * The point is that a clip still plays after a refresh. Without this, the
 * timeline survives (it is in IndexedDB) but the bytes do not, and every
 * clip falls into the "not local yet" state — which is honest but useless
 * for a single-user prototype.
 *
 * Two rules:
 *   1. Availability is detected, never assumed. Where OPFS is missing, the
 *      app keeps the current behaviour (blob URLs for the session) and
 *      says so in the status bar.
 *   2. A file that does not fit is refused *before* writing, with a
 *      message that says how much room is left. Quota errors must not
 *      arrive as a half-written file.
 */

export const MEDIA_DIR = "media";

export type MediaWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string; readonly reason: "too-large" | "unavailable" | "failed" };

export function isOpfsAvailable(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      navigator.storage !== undefined &&
      typeof navigator.storage.getDirectory === "function"
    );
  } catch {
    return false;
  }
}

async function mediaDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isOpfsAvailable()) {
    throw new Error("OPFS is not available in this browser");
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(workspaceKey(MEDIA_DIR), { create: true });
}

/** Free space according to the browser, or null if it will not say. */
export async function freeBytes(): Promise<number | null> {
  try {
    if (typeof navigator === "undefined" || navigator.storage === undefined) {
      return null;
    }
    const estimate = await navigator.storage.estimate();
    if (estimate.quota === undefined || estimate.usage === undefined) return null;
    return Math.max(0, estimate.quota - estimate.usage);
  } catch {
    return null;
  }
}

/**
 * Write a media file under its asset id. Refuses before writing when the
 * browser says there is not enough room.
 */
export async function writeMedia(
  assetId: string,
  file: File,
): Promise<MediaWriteResult> {
  if (!isOpfsAvailable()) {
    return {
      ok: false,
      error: "this browser has no private file system — media lasts for this session only",
      reason: "unavailable",
    };
  }
  const free = await freeBytes();
  if (free !== null && file.size > free) {
    return {
      ok: false,
      error:
        `not enough room to store ${file.name}: ` +
        `${formatBytes(file.size)} needed, ${formatBytes(free)} free`,
      reason: "too-large",
    };
  }
  try {
    const dir = await mediaDirectory();
    const handle = await dir.getFileHandle(assetId, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "could not store the file",
      reason: "failed",
    };
  }
}

/** Read a stored media file, or null when it is not there. */
export async function readMedia(assetId: string): Promise<File | null> {
  if (!isOpfsAvailable()) return null;
  try {
    const dir = await mediaDirectory();
    const handle = await dir.getFileHandle(assetId);
    return await handle.getFile();
  } catch {
    return null;
  }
}

/** A playable URL for a stored media file, or null when it is not there. */
export async function readMediaUrl(assetId: string): Promise<string | null> {
  const file = await readMedia(assetId);
  if (file === null) return null;
  // Rebuild as a File so the original MIME type survives: the browser needs
  // it to decode the stream.
  const typed = new File([file], `${assetId}.media`, { type: file.type });
  return URL.createObjectURL(typed);
}

export async function deleteMedia(assetId: string): Promise<boolean> {
  if (!isOpfsAvailable()) return false;
  try {
    const dir = await mediaDirectory();
    await dir.removeEntry(assetId);
    return true;
  } catch {
    return false;
  }
}

export interface MediaUsage {
  readonly files: number;
  readonly bytes: number;
}

/** How much media is stored, and in how many files. */
export async function mediaUsage(): Promise<MediaUsage> {
  if (!isOpfsAvailable()) return { files: 0, bytes: 0 };
  try {
    const dir = await mediaDirectory();
    let files = 0;
    let bytes = 0;
    // `values()` is an async iterator on the directory handle.
    const iterable = dir as unknown as {
      values?: () => AsyncIterable<FileSystemHandle>;
    };
    if (iterable.values === undefined) return { files: 0, bytes: 0 };
    for await (const handle of iterable.values()) {
      const fileHandle = handle as FileSystemFileHandle;
      if (typeof fileHandle.getFile !== "function") continue;
      files += 1;
      bytes += (await fileHandle.getFile()).size;
    }
    return { files, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
