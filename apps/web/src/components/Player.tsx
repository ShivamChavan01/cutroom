import { useEffect, useRef } from "react";
import { type Clip, clipsOnTrack, timelineDuration } from "@cutroom/engine";
import { nextClip, resolveActiveClip } from "../lib/playback";
import { resolveAssetUrl } from "../lib/assets";
import { useEditorStore } from "../store";

/**
 * How far ahead of a clip boundary to start preloading the next source.
 * How far the element may drift before we correct it (fighting the
 * element's own clock every frame causes stutter — correct, don't force).
 */
const PRELOAD_AHEAD_MS = 1_000;
const DRIFT_TOLERANCE_MS = 250;

function firstVideoTrackId(timeline: {
  tracks: readonly { id: string; kind: string }[];
}): string {
  return timeline.tracks.find((track) => track.kind === "video")?.id ?? "v1";
}

export function Player() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const preloadRef = useRef<HTMLVideoElement | null>(null);
  /** Asset currently loaded in the main element. Source of swap decisions. */
  const loadedAssetRef = useRef<string | null>(null);
  /** When the current src swap started — stall measurement for the writeup. */
  const swapStartedAtRef = useRef<number>(0);
  /** Latest clips, read by the loop without restarting it on every edit. */
  const clipsRef = useRef<readonly Clip[]>([]);

  const timeline = useEditorStore((state) => state.timeline);
  const playheadMs = useEditorStore((state) => state.playheadMs);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  const clips = clipsOnTrack(timeline, firstVideoTrackId(timeline));
  clipsRef.current = clips;

  /**
   * The one sync: make the element match (clips, playhead). Returns false
   * when there is nothing to play (gap / missing media), true otherwise.
   * Edits mid-playback just change what the next call resolves — no loop
   * restart, no teardown, so split/trim/delete while playing only ever
   * cause a swap when the active *asset* actually changed.
   */
  const syncElement = (playhead: number, autoplay: boolean): boolean => {
    const video = videoRef.current;
    if (video === null) return false;
    const active = resolveActiveClip(clipsRef.current, playhead);
    if (active === null) return false;
    const url = resolveAssetUrl(active.clip.assetId);
    if (url === undefined) return false;
    if (loadedAssetRef.current !== active.clip.assetId) {
      loadedAssetRef.current = active.clip.assetId;
      swapStartedAtRef.current = performance.now();
      video.src = url;
      video.onloadedmetadata = () => {
        video.currentTime = active.sourceTimeMs / 1000;
        if (autoplay) void video.play().catch(() => undefined);
      };
    } else if (!video.seeking) {
      const driftMs = Math.abs(video.currentTime * 1000 - active.sourceTimeMs);
      if (driftMs > DRIFT_TOLERANCE_MS) {
        video.currentTime = active.sourceTimeMs / 1000;
      }
      if (autoplay && video.paused) void video.play().catch(() => undefined);
    }
    return true;
  };

  const stopAtGap = () => {
    videoRef.current?.pause();
    useEditorStore.getState().pause();
  };

  // -- scrubbing (paused): playhead is the source of truth ----------------
  useEffect(() => {
    if (isPlaying) return;
    syncElement(playheadMs, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadMs, isPlaying, timeline]);

  // -- playback loop: runs until paused, never restarts on edits ---------
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let lastTick = performance.now();
    const tick = (now: number) => {
      const store = useEditorStore.getState();
      const dtMs = now - lastTick;
      lastTick = now;

      // Advance by real elapsed time, not a fixed 1/60 guess.
      const advanced = store.playheadMs + dtMs;
      if (!syncElement(advanced, true)) {
        // Gap, missing media, or end of timeline: stop, don't freeze.
        stopAtGap();
        return;
      }
      const video = videoRef.current;
      if (video !== null && !video.seeking && !video.paused) {
        // Re-derive from the element clock when it disagrees — the one
        // clock that cannot lie about what's audible.
        const active = resolveActiveClip(clipsRef.current, advanced);
        if (active !== null) {
          const implied = active.clip.start + (video.currentTime * 1000 - active.clip.inPoint);
          store.setPlayhead(
            Math.abs(implied - advanced) > DRIFT_TOLERANCE_MS ? implied : advanced,
          );
        } else {
          store.setPlayhead(advanced);
        }
      } else {
        store.setPlayhead(advanced);
      }

      // Preload whatever comes next while still inside the current clip.
      const current = resolveActiveClip(clipsRef.current, store.playheadMs);
      if (current !== null) {
        const next = nextClip(clipsRef.current, current.clip);
        const untilEnd =
          current.clip.start + current.clip.duration - store.playheadMs;
        if (next !== null && untilEnd < PRELOAD_AHEAD_MS) {
          const url = resolveAssetUrl(next.assetId);
          const preloader = preloadRef.current;
          if (url !== undefined && preloader !== null && preloader.src !== url) {
            preloader.src = url;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // -- transport ----------------------------------------------------------
  const toggle = () => {
    const store = useEditorStore.getState();
    const video = videoRef.current;
    if (video === null) return;
    if (store.isPlaying) {
      video.pause();
      store.pause();
      return;
    }
    const liveClips = clipsOnTrack(
      store.timeline,
      firstVideoTrackId(store.timeline),
    );
    let at = store.playheadMs;
    if (resolveActiveClip(liveClips, at) === null) {
      // Pressing play in a gap (or past the end) restarts from zero rather
      // than silently doing nothing.
      if (at >= timelineDuration(store.timeline)) at = 0;
      else return;
      store.setPlayhead(at);
    }
    if (syncElement(at, true)) store.play();
  };

  const activeNow = resolveActiveClip(clips, playheadMs);
  const missingMedia =
    activeNow !== null && resolveAssetUrl(activeNow.clip.assetId) === undefined;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          position: "relative",
          width: 640,
          height: 360,
          background: "#000",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <video
          ref={videoRef}
          style={{ width: "100%", height: "100%" }}
          playsInline
          preload="auto"
          onPlaying={() => {
            // Stall evidence: swap-to-audible latency per boundary crossing.
            if (swapStartedAtRef.current > 0) {
              const stallMs = performance.now() - swapStartedAtRef.current;
              swapStartedAtRef.current = 0;
              console.info(`[player] boundary swap stall: ${stallMs.toFixed(0)}ms`);
            }
          }}
        />
        {/* Hidden preloader for the next clip's source. */}
        <video ref={preloadRef} style={{ display: "none" }} preload="auto" muted />
        {activeNow === null && (
          <div
            style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: "#868e96", fontSize: 13,
            }}
          >
            Gap — no clip under the playhead
          </div>
        )}
        {missingMedia && (
          <div
            style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: "#ffa94d", fontSize: 13,
            }}
          >
            Media not local yet: {activeNow?.clip.assetId}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={toggle}>{isPlaying ? "Pause" : "Play"}</button>
        <span style={{ fontSize: 12, color: "#868e96", alignSelf: "center" }}>
          {activeNow !== null
            ? `${activeNow.clip.id} @ src ${(activeNow.sourceTimeMs / 1000).toFixed(2)}s`
            : "—"}
        </span>
      </div>
    </div>
  );
}
