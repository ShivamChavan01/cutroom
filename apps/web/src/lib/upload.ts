import { type Asset } from "@cutroom/engine";
import { registerAssetUrl } from "./assets";
import { isOpfsAvailable, writeMedia } from "./media/opfs";
import { useEditorStore } from "../store";
import { clipForMedia } from "./mediaLibrary";

/** Short deterministic id when hashing is unavailable. Never silent. */
async function assetIdFor(file: File): Promise<string> {
  try {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hex.slice(0, 16);
  } catch {
    return `upload-${Date.now()}-${file.size}`;
  }
}

interface MediaMetadata {
  readonly duration: number;
  readonly width?: number;
  readonly height?: number;
}

function probeMedia(url: string): Promise<MediaMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const timer = setTimeout(() => fail(), 10_000);
    const cleanup = (): void => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    video.onloadedmetadata = () => {
      const duration = Math.round(video.duration * 1000);
      if (!Number.isFinite(duration) || duration <= 0) {
        fail();
        return;
      }
      const dimensions = video.videoWidth > 0 && video.videoHeight > 0
        ? { width: video.videoWidth, height: video.videoHeight }
        : {};
      cleanup();
      resolve({ duration, ...dimensions });
    };
    const fail = (): void => {
      cleanup();
      reject(new Error(`cannot read ${url}`));
    };
    video.onerror = fail;
    video.src = url;
  });
}

function probeImage(url: string): Promise<MediaMetadata> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => fail(), 10_000);
    const cleanup = (): void => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
    };
    const fail = (): void => {
      cleanup();
      reject(new Error(`cannot read ${url}`));
    };
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (width <= 0 || height <= 0) {
        fail();
        return;
      }
      cleanup();
      resolve({ duration: 5_000, width, height });
    };
    image.onerror = fail;
    image.src = url;
  });
}

function mediaKind(file: File): Asset["kind"] {
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name)) return "image";
  if (file.type.startsWith("audio/") || /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(file.name)) return "audio";
  return "video";
}

export interface UploadReport {
  readonly added: readonly string[];
  readonly skipped: readonly { name: string; reason: string }[];
  /** Set when the file could not be stored for the session (no OPFS, or no room). */
  readonly storageWarning: string | null;
}

export async function uploadFiles(
  files: Iterable<File>,
  onStatus?: (status: string | null) => void,
): Promise<UploadReport> {
  const added: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let storageWarning: string | null = null;
  for (const file of Array.from(files)) {
    onStatus?.(`reading ${file.name}…`);
    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
      const kind = mediaKind(file);
      const [id, metadata] = await Promise.all([
        assetIdFor(file),
        kind === "image" ? probeImage(url) : probeMedia(url),
      ]);

      // Store the bytes so the clip still plays after a refresh. If the
      // browser has no private file system, or no room, the session URL
      // still works for now — but say so, loudly, once.
      if (isOpfsAvailable()) {
        const written = await writeMedia(id, file);
        if (!written.ok) {
          storageWarning = written.error;
        }
      } else {
        storageWarning =
          "this browser has no private file system — media lasts for this session only";
      }

      // Another import may have changed the timeline while metadata loaded.
      const store = useEditorStore.getState();
      const previous = store.timeline.assets[id];
      if (previous === undefined) store.addAsset({id, kind, ...metadata, name: file.name, mimeType: file.type, bytes: file.size});
      const clip = clipForMedia(useEditorStore.getState().timeline, id);
      store.dispatch({
        type: "addClip",
        clip,
      });
      registerAssetUrl(id, url);
      added.push(clip.id);
    } catch (error) {
      if (url !== null) URL.revokeObjectURL(url);
      skipped.push({
        name: file.name,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
  onStatus?.(null);
  return { added, skipped, storageWarning };
}
