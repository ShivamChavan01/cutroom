import { type Clip, clipsOnTrack, timelineDuration } from "@cutroom/engine";
import { useEffect, useRef, useState } from "react";
import { nextClip, resolveActiveClip } from "../lib/playback";
import { resolveAssetUrl } from "../lib/assets";
import {
  decideSwap,
  decideWarm,
  isSameSource,
  otherSide,
  warmMatches,
  type Side,
} from "../lib/swap";
import { Pause, Play } from "lucide-react";
import { useEditorStore } from "../store";
import { Button } from "./ui/button";

/**
 * Double-buffered player.
 *
 * Two <video> elements, one visible. The hidden element is warmed for the
 * next clip: src set ~1s before the boundary, seek to inPoint on
 * loadedmetadata, and only treated as ready after `seeked` with
 * `readyState >= HAVE_ENOUGH_DATA` (4). At the boundary the roles flip and
 * the warm element plays — the previously-live element is paused, never
 * re-sourced mid-playback.
 *
 * Stall metric: boundary tick to the new element's first `playing` event,
 * logged as `(preload on)` or `(preload off)`. `?preload=off` disables
 * warming entirely so both modes measure the same interval.
 */

const DRIFT_TOLERANCE_MS = 250;
const PRELOAD_AHEAD_MS = 1_000;
const READY_STATE_ENOUGH = 4;
const SEEK_MATCH_TOLERANCE_MS = 120;



function firstVideoTrackId(timeline: {
  tracks: readonly { id: string; kind: string }[];
}): string {
  return timeline.tracks.find((track) => track.kind === "video")?.id ?? "v1";
}

interface WarmState {
  readonly side: Side;
  readonly assetId: string;
  readonly clip: Clip;
}

declare global {
  interface Window {
    __stalls?: { mode: string; ms: number }[];
  }
}

function recordStall(mode: string, ms: number): void {
  window.__stalls = [...(window.__stalls ?? []), { mode, ms }];
  console.info(`[player] boundary swap stall (${mode}): ${ms.toFixed(0)}ms`);
}

export function Player() {
  const videoARef = useRef<HTMLVideoElement | null>(null);
  const videoBRef = useRef<HTMLVideoElement | null>(null);
  // liveSide is state (owns visibility) with a ref mirror for callbacks.
  const [liveSide, setLiveSideState] = useState<Side>("a");
  const liveSideRef = useRef<Side>("a");
  const loadedRef = useRef<Record<Side, string | null>>({ a: null, b: null });
  const warmRef = useRef<WarmState | null>(null);
  const swapStartedAtRef = useRef(0);

  const preloadEnabled =
    new URLSearchParams(window.location.search).get("preload") !== "off";

  const timeline = useEditorStore((state) => state.timeline);
  const playheadMs = useEditorStore((state) => state.playheadMs);
  const isPlaying = useEditorStore((state) => state.isPlaying);

  const clips = clipsOnTrack(timeline, firstVideoTrackId(timeline));

  const setLiveSide = (side: Side): void => {
    liveSideRef.current = side;
    setLiveSideState(side);
  };
  const elementFor = (side: Side): HTMLVideoElement | null =>
    side === "a" ? videoARef.current : videoBRef.current;

  /**
   * Warm the hidden element for `next`. No-ops (leaving prior warm state)
   * when preloading is disabled, the element is missing, or the URL is
   * unknown. Calls onReady once the element sits paused on inPoint.
   */
  const ensureWarm = (next: Clip | null, onReady: () => void): void => {
    if (!preloadEnabled) return;
    const side = otherSide(liveSideRef.current);
    const el = elementFor(side);
    if (el === null || next === null) return;
    const url = resolveAssetUrl(next.assetId);
    if (url === undefined) {
      if (warmRef.current?.side === side) warmRef.current = null;
      return;
    }
    if (warmMatches(warmRef.current, side, next.assetId)) {
      if (
        el.readyState >= READY_STATE_ENOUGH &&
        el.paused &&
        Math.abs(el.currentTime * 1000 - next.inPoint) <= SEEK_MATCH_TOLERANCE_MS
      ) {
        onReady();
      }
      return;
    }
    warmRef.current = { side, assetId: next.assetId, clip: next };
    el.src = url;
    el.onloadedmetadata = () => {
      el.currentTime = next.inPoint / 1000;
      el.onseeked = () => {
        const stillCurrent =
          warmRef.current !== null &&
          warmRef.current.side === side &&
          warmRef.current.assetId === next.assetId;
        if (stillCurrent && el.readyState >= READY_STATE_ENOUGH && el.paused) {
          onReady();
        }
      };
    };
  };

  const swapToWarm = (warm: WarmState, sourceTimeMs: number, autoplay: boolean): void => {
    const el = elementFor(warm.side);
    if (el === null) return;
    const prev = elementFor(liveSideRef.current);
    if (prev !== null && prev !== el) prev.pause();
    swapStartedAtRef.current = performance.now();
    // Exact position: warming parked on inPoint, the playhead may be past it.
    if (Math.abs(el.currentTime * 1000 - sourceTimeMs) > SEEK_MATCH_TOLERANCE_MS) {
      el.currentTime = sourceTimeMs / 1000;
    }
    if (autoplay) void el.play().catch(() => undefined);
    warmRef.current = null;
    setLiveSide(warm.side);
  };

  const coldLoad = (
    side: Side,
    assetId: string,
    url: string,
    sourceTimeMs: number,
    autoplay: boolean,
  ): void => {
    const el = elementFor(side);
    if (el === null) return;
    loadedRef.current[side] = assetId;
    if (isSameSource(el.src, url)) {
      // Element already shows this source (e.g. refs reset under a live
      // element): seek and go. Re-setting src would force a full reload.
      // No stall starts here — nothing swapped.
      el.currentTime = sourceTimeMs / 1000;
      if (autoplay && el.paused) void el.play().catch(() => undefined);
      return;
    }
    swapStartedAtRef.current = performance.now();
    el.src = url;
    el.onloadedmetadata = () => {
      el.currentTime = sourceTimeMs / 1000;
      if (autoplay) void el.play().catch(() => undefined);
    };
  };

  /**
   * Make the visible element match (clips, playhead). Returns false when
   * there is nothing playable (gap / missing media).
   */
  const syncTo = (playhead: number, autoplay: boolean): boolean => {
    const active = resolveActiveClip(clips, playhead);
    if (active === null) return false;
    const url = resolveAssetUrl(active.clip.assetId);
    if (url === undefined) return false;
    const side = liveSideRef.current;
    const live = elementFor(side);
    if (live === null) return false;

    const warm = warmRef.current;
    const decision = decideSwap(active.clip.assetId, {
      liveSide: side,
      loadedAsset: loadedRef.current,
      warm:
        warm === null
          ? null
          : {
              side: warm.side,
              assetId: warm.assetId,
              elementReady:
                (elementFor(warm.side)?.readyState ?? 0) >= READY_STATE_ENOUGH,
            },
    });
    if (decision.kind === "flip" && warm !== null) {
      swapToWarm(warm, active.sourceTimeMs, autoplay);
      return true;
    }
    if (decision.kind === "coldLoad") {
      coldLoad(decision.side, active.clip.assetId, url, active.sourceTimeMs, autoplay);
      return true;
    }
    if (!live.seeking) {
      const driftMs = Math.abs(live.currentTime * 1000 - active.sourceTimeMs);
      if (driftMs > DRIFT_TOLERANCE_MS) {
        live.currentTime = active.sourceTimeMs / 1000;
      }
      if (autoplay && live.paused) void live.play().catch(() => undefined);
    }
    return true;
  };

  // Scrubbing (paused): playhead is the source of truth.
  useEffect(() => {
    if (isPlaying) return;
    syncTo(playheadMs, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadMs, isPlaying, timeline]);

  // Playback loop.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let lastTick = performance.now();
    const tick = (now: number) => {
      const store = useEditorStore.getState();
      const advanced = store.playheadMs + (now - lastTick);
      lastTick = now;

      const current = resolveActiveClip(clips, advanced);
      const next = current === null ? null : nextClip(clips, current.clip);
      const untilEnd =
        current === null
          ? Number.POSITIVE_INFINITY
          : current.clip.start + current.clip.duration - advanced;
      const warmAction = decideWarm(
        next?.assetId ?? null,
        untilEnd,
        { liveSide: liveSideRef.current, warm: warmRef.current },
        { preloadEnabled, preloadAheadMs: PRELOAD_AHEAD_MS },
      );
      if (warmAction === "warm" && next !== null) {
        ensureWarm(next, () => undefined);
      }

      if (!syncTo(advanced, true)) {
        elementFor(liveSideRef.current)?.pause();
        store.pause();
        return;
      }
      const live = elementFor(liveSideRef.current);
      if (live !== null && !live.seeking && !live.paused) {
        const active = resolveActiveClip(clips, advanced);
        if (active !== null) {
          const implied =
            active.clip.start + (live.currentTime * 1000 - active.clip.inPoint);
          store.setPlayhead(
            Math.abs(implied - advanced) > DRIFT_TOLERANCE_MS ? implied : advanced,
          );
        } else {
          store.setPlayhead(advanced);
        }
      } else {
        store.setPlayhead(advanced);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, timeline]);

  const activeNow = resolveActiveClip(clips, playheadMs);
  const missingMedia =
    activeNow !== null && resolveAssetUrl(activeNow.clip.assetId) === undefined;
  const mode = preloadEnabled ? "preload on" : "preload off";

  const onPlaying = (): void => {
    if (swapStartedAtRef.current <= 0) return;
    const ms = performance.now() - swapStartedAtRef.current;
    swapStartedAtRef.current = 0;
    recordStall(mode, ms);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 960,
          aspectRatio: "16 / 9",
          background: "#000",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <video
          ref={videoARef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: liveSide === "a" ? "block" : "none",
          }}
          playsInline
          preload="auto"
          onPlaying={onPlaying}
        />
        <video
          ref={videoBRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: liveSide === "b" ? "block" : "none",
          }}
          playsInline
          preload="auto"
          onPlaying={onPlaying}
        />
        {activeNow === null && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#868e96",
              pointerEvents: "none",
            }}
          >
            Gap — no clip under the playhead
          </div>
        )}
        {missingMedia && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffa94d",
              pointerEvents: "none",
            }}
          >
            Media not local yet: {activeNow?.clip.assetId}
          </div>
        )}
      </div>
    </div>
  );
}
