import { useRef, useState } from "react";
import { makeClip, timelineDuration } from "@cutroom/engine";
import { registerAssetUrl } from "../lib/assets";
import { useEditorStore } from "../store";

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

function probeDurationMs(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const ms = Math.round(video.duration * 1000);
      URL.revokeObjectURL(video.src);
      resolve(ms);
    };
    video.onerror = () => reject(new Error(`cannot read ${url}`));
    video.src = url;
  });
}

/**
 * Add any video files. Each file becomes a content-addressed asset
 * (sha256, matching the engine's story) plus a clip appended after the
 * current end of V1. Object URLs stand in for the real blob store until
 * the asset layer exists.
 */
export function UploadButton() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    for (const file of files) {
      // Re-read every iteration: each dispatch replaces the timeline, and
      // a stale snapshot would stack multi-file uploads on top of each other.
      const store = useEditorStore.getState();
      setStatus(`reading ${file.name}…`);
      try {
        const url = URL.createObjectURL(file);
        const [id, duration] = await Promise.all([
          assetIdFor(file),
          probeDurationMs(url),
        ]);
        store.addAsset({ id, kind: "video", duration, bytes: file.size });
        registerAssetUrl(id, url);
        // Re-uploading the same file reuses the asset (content-addressed)
        // but needs a fresh clip id — the engine rejects duplicates loudly.
        let clipId = `clip-${id.slice(0, 8)}`;
        for (let n = 2; store.timeline.clips[clipId] !== undefined; n++) {
          clipId = `clip-${id.slice(0, 8)}-${n}`;
        }
        const at = timelineDuration(store.timeline);
        store.dispatch({
          type: "addClip",
          clip: makeClip({
            id: clipId,
            trackId: "v1",
            assetId: id,
            start: at,
            inPoint: 0,
            duration,
            volume: 1,
          }),
        });
      } catch (error) {
        setStatus(
          `skipped ${file.name}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
        return;
      }
    }
    setStatus(null);
  };

  return (
    <span>
      <button onClick={() => inputRef.current?.click()}>Add video</button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          void onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {status !== null && (
        <span style={{ fontSize: 12, color: "#868e96", marginLeft: 6 }}>{status}</span>
      )}
    </span>
  );
}
