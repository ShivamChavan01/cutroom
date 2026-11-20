import {updatePlaybackErrors, type PlaybackError} from "../lib/playbackErrors";
import { assetById, type Clip, type Track } from "@cutroom/engine";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { advancePlayback, isLargeScrubJump, clipTransform, nextClip, playbackGain, resolveActiveClip, resolvePlaybackLayers } from "../lib/playback";
import { indexCutStarts, nextCut } from "../lib/timecode";
import { indexedClipsOnTrack, indexedTimelineDuration } from "../lib/clipIndex";
import { restoreOriginalMedia, useEditingCopies } from "../lib/media/editingCopy";
import { resolveAssetUrl, useAssetUrls } from "../lib/assets";
import { decideSwap, isSameSource, otherSide, type Side } from "../lib/swap";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";

const DRIFT_TOLERANCE_MS = 250;
const PRELOAD_AHEAD_MS = 1_000;

interface VideoClockSample {
  clip: Clip;
  at: number;
}

interface WarmState {
  readonly side: Side;
  readonly assetId: string;
  readonly inPoint: number;
}

declare global {
  interface Window {
    __stalls?: { mode: string; ms: number }[];
  }
}

function TrackPlayer({ track, order, muted, buffering, videoClock, onMediaError, onMediaReady }: {
  readonly track: Track;
  readonly order: number;
  readonly muted: boolean;
  readonly buffering: RefObject<boolean>;
  readonly videoClock: RefObject<VideoClockSample | null>;
  readonly onMediaError: (trackId: string, assetId: string, message: string) => void;
  readonly onMediaReady: (trackId: string, assetId: string) => void;
}) {
  const timeline = useEditorStore((state) => state.timeline);
  const at = useEditorStore((state) => state.playheadMs);
  const playing = useEditorStore((state) => state.isPlaying);
  const scrubbing = useUiStore((state) => track.kind === "video" && state.scrubbing);
  const clips = useMemo(() => indexedClipsOnTrack(timeline, track.id), [timeline, track.id]);
  const active = resolveActiveClip(clips, at);
  const asset = active === null ? undefined : assetById(timeline, active.clip.assetId);
  const assetId = active?.clip.assetId;
  const onError = useCallback((message: string) => {if (assetId !== undefined) onMediaError(track.id, assetId, message);}, [assetId, track.id, onMediaError]);
  const onReady = useCallback(() => {if (assetId !== undefined) onMediaReady(track.id, assetId);}, [assetId, track.id, onMediaReady]);
  const original = useAssetUrls((urls) => active === null ? undefined : urls.get(active.clip.assetId));
  const editingCopy = useEditingCopies(copies => assetId === undefined ? undefined : copies.get(assetId));
  const source = editingCopy?.url ?? original;
  const slots = useRef<Record<Side, HTMLMediaElement | null>>({ a: null, b: null });
  const live = useRef<Side>("a");
  const [visibleSide, setVisibleSide] = useState<Side>("a");
  const loaded = useRef<Record<Side, string | null>>({ a: null, b: null });
  const warm = useRef<WarmState | null>(null);
  const lastScrubPosition = useRef<number | null>(null);
  const replacedScrubSeek = useRef(false);
  const swapStartedAt = useRef(0);
  const preload = typeof window === "undefined" || new URLSearchParams(window.location.search).get("preload") !== "off";
  const setA = useCallback((element: HTMLMediaElement | null) => { slots.current.a = element; }, []);
  const setB = useCallback((element: HTMLMediaElement | null) => { slots.current.b = element; }, []);

  useEffect(() => {
    const largeJump = scrubbing && isLargeScrubJump(lastScrubPosition.current, at);
    lastScrubPosition.current = scrubbing ? at : null;
    if (!scrubbing) replacedScrubSeek.current = false;

    const pauseSlots = (): void => {
      slots.current.a?.pause();
      slots.current.b?.pause();
    };
    const start = (element: HTMLMediaElement): void => {
      if (!useEditorStore.getState().isPlaying || buffering.current) {
        element.pause();
        return;
      }
      if (!element.paused || element.ended) return;
      void element.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        onError(error instanceof Error ? error.message : "Playback could not start");
      });
    };
    const current = resolveActiveClip(clips, at);
    if (current === null || source === undefined || assetById(timeline, current.clip.assetId)?.kind === "image") {
      pauseSlots();
      return;
    }

    const desired = current.clip;
    let side = live.current;
    const activeElement = slots.current[side];
    const parkedSide = otherSide(side);
    const parkedElement = slots.current[parkedSide];
    const candidate = warm.current;
    const warmElement = candidate === null ? null : slots.current[candidate.side];
    const decision = decideSwap(desired.assetId, {
      liveSide: side,
      loadedAsset: loaded.current,
      // Keep the previous video available even if preloading missed the cut.
      useParkedSlot: !!activeElement?.src && !isSameSource(activeElement.src, source) && parkedElement !== null
        && (track.kind === "video" || (parkedElement.error === null && isSameSource(parkedElement.src, source))),
      warm: candidate === null ? null : {
        ...candidate,
        elementReady: warmElement !== null && warmElement.readyState >= 3 && isSameSource(warmElement.src, source),
      },
    });
    const nextSide = decision.kind === "flip" ? decision.to : side;
    const switched = nextSide !== side;
    if (switched) {
      slots.current[side]?.pause();
      side = nextSide;
      live.current = side;
      warm.current = null;
      swapStartedAt.current = performance.now();
      setVisibleSide(side);
    }
    const element = slots.current[side];
    if (element === null) return;
    loaded.current[side] = desired.assetId;
    element.onseeked = () => {
      const store = useEditorStore.getState();
      if (store.isPlaying || live.current !== side) return;
      const latest = resolveActiveClip(indexedClipsOnTrack(store.timeline, track.id), store.playheadMs);
      if (latest?.clip.assetId !== desired.assetId) return;
      const targetTime = latest.sourceTimeMs / 1000;
      if (Math.abs(element.currentTime - targetTime) > 0.001) element.currentTime = targetTime;
    };
    const hidden = slots.current[otherSide(side)];
    hidden?.pause();
    if (hidden !== null) hidden.volume = 0;
    element.volume = muted ? 0 : playbackGain(desired, track);

    element.onloadedmetadata = () => {
      const store = useEditorStore.getState();
      if (live.current !== side) return;
      const latest = resolveActiveClip(indexedClipsOnTrack(store.timeline, track.id), store.playheadMs);
      if (latest?.clip.assetId !== desired.assetId) return;
      const targetTime = latest.sourceTimeMs / 1000;
      if (Math.abs(element.currentTime - targetTime) > 0.001) element.currentTime = targetTime;
      start(element);
    };
    if (!isSameSource(element.src, source) || (switched && element.error !== null)) {
      swapStartedAt.current = performance.now();
      element.src = source;
    } else {
      if (switched && element.readyState >= 2) onReady();
      const sourceTime = current.sourceTimeMs / 1000;
      const tolerance = playing ? DRIFT_TOLERANCE_MS : 1;
      // Interrupt at most once per drag so continuous movement can still present frames.
      const replaceSeek = !playing && largeJump && element.seeking && !replacedScrubSeek.current;
      // A playhead update sampled from this video must never seek the video back.
      // Explicit seeks, cuts and source changes still align the active element.
      const followsVideo = playing && videoClock.current?.clip === desired && videoClock.current.at === at;
      if (!followsVideo && (!(playing || scrubbing) || !element.seeking || replaceSeek) && element.readyState >= 1 && Math.abs(element.currentTime - sourceTime) * 1000 > tolerance) {
        if (replaceSeek) replacedScrubSeek.current = true;
        element.currentTime = sourceTime;
      }
      start(element);
    }

    const next = nextClip(clips, desired);
    if (!preload || !playing || next === null || desired.start + desired.duration - at >= PRELOAD_AHEAD_MS) return;
    if (next.assetId === desired.assetId || assetById(timeline, next.assetId)?.kind === "image") return;
    const nextSource = useEditingCopies.getState().get(next.assetId)?.url ?? resolveAssetUrl(next.assetId);
    const hiddenSide = otherSide(side);
    const target = slots.current[hiddenSide];
    if (target === null || nextSource === undefined) return;
    if (warm.current?.side === hiddenSide && warm.current.assetId === next.assetId && warm.current.inPoint === next.inPoint && isSameSource(target.src, nextSource)) return;
    warm.current = { side: hiddenSide, assetId: next.assetId, inPoint: next.inPoint };
    const cue = () => { target.currentTime = next.inPoint / 1000; };
    target.onloadedmetadata = cue;
    if (!isSameSource(target.src, nextSource) || target.error !== null) target.src = nextSource;
    else if (target.readyState >= 1) cue();
  }, [at, playing, scrubbing, clips, source, timeline, track, muted, buffering, videoClock, preload, onError, onReady]);

  useEffect(() => () => {
    for (const element of Object.values(slots.current)) {
      if (element === null) continue;
      element.onloadedmetadata = null;
      element.onseeked = null;
      element.pause();
    }
  }, []);

  const onPlaying = (): void => {
    onReady();
    if (swapStartedAt.current <= 0) return;
    window.__stalls = [...(window.__stalls ?? []), {
      mode: preload ? "preload on" : "preload off",
      ms: performance.now() - swapStartedAt.current,
    }];
    swapStartedAt.current = 0;
  };
  const visual = track.kind === "video" && active !== null && asset?.kind !== "audio";
  const image = asset?.kind === "image";
  const mediaStyle = (side: Side) => ({
    position: "absolute" as const,
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain" as const,
    transformOrigin: "center",
    transform: active === null ? undefined : clipTransform(active.clip),
    display: visual && !image && side === visibleSide ? "block" : "none",
  });
  const failed = (side: Side): void => {
    if (side !== live.current || active === null || image) return;
    if (editingCopy && slots.current[side]?.currentSrc === editingCopy.url) {
      restoreOriginalMedia(active.clip.assetId);
      return;
    }
    onError(`Could not decode ${asset?.name ?? active.clip.assetId}`);
  };
  const ready = (side: Side): void => {
    if (side === live.current) onReady();
  };

  return (
    <div data-player-track={track.id} data-active-clip={active?.clip.id} style={{ position: "absolute", inset: 0, zIndex: order, pointerEvents: "none" }}>
      {track.kind === "audio" ? (
        <>
          <audio data-player-live={visibleSide === "a"} ref={setA} preload="auto" onPlaying={onPlaying} onLoadedData={onReady} onError={() => failed("a")} />
          <audio data-player-live={visibleSide === "b"} ref={setB} preload="auto" onPlaying={onPlaying} onError={() => failed("b")} />
        </>
      ) : (
        <>
          <video data-player-live={visibleSide === "a"} ref={setA} style={mediaStyle("a")} playsInline preload="auto" onPlaying={onPlaying} onLoadedData={() => ready("a")} onError={() => failed("a")} />
          <video data-player-live={visibleSide === "b"} ref={setB} style={mediaStyle("b")} playsInline preload="auto" onPlaying={onPlaying} onLoadedData={() => ready("b")} onError={() => failed("b")} />
        </>
      )}
      {visual && image && source !== undefined && active !== null && (
        <img src={source} alt={asset?.name ?? "Timeline graphic"} onLoad={onReady} onError={() => onError(`Could not decode ${asset?.name ?? active.clip.assetId}`)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", transform: clipTransform(active.clip), transformOrigin: "center" }} />
      )}
    </div>
  );
}

export function Player({ zoom = "fit", fill = false }: { readonly zoom?: "fit" | number; readonly fill?: boolean }) {
  const timeline = useEditorStore((state) => state.timeline);
  const sessionId = useEditorStore((state) => state.sessionId);
  const at = useEditorStore((state) => state.playheadMs);
  const playing = useEditorStore((state) => state.isPlaying);
  const hidden = useUiStore((state) => state.hiddenTrackIds);
  const muted = useUiStore((state) => state.mutedTrackIds);
  const urls = useAssetUrls();
  const buffering = useRef(false);
  const videoClock = useRef<VideoClockSample | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 960, height: 540 });
  const [errors, setErrors] = useState<ReadonlyMap<string, PlaybackError>>(new Map());
  const onError = useCallback((trackId: string, assetId: string, message: string) => {
    setErrors(previous => updatePlaybackErrors(previous, {kind: "failed", trackId, assetId, message}));
    useEditorStore.getState().pause();
  }, []);
  const onReady = useCallback((trackId: string, assetId: string) => setErrors(previous => updatePlaybackErrors(previous, {kind: "ready", trackId, assetId})), []);
  const cutStarts = useMemo(() => indexCutStarts(Object.values(timeline.clips)), [timeline.clips]);
  const visibleTracks = timeline.tracks.filter((track) => !hidden.includes(track.id));
  const layers = resolvePlaybackLayers(timeline, at, hidden);
  const visualLayers = layers.filter((layer) => layer.track.kind === "video");
  const activeErrors = layers.flatMap(layer => {const error = errors.get(layer.track.id); return error?.assetId === layer.clip.assetId ? [{trackId: layer.track.id, message: error.message}] : [];});
  const missing = layers.find((layer) => !urls.has(layer.clip.assetId));
  const canvasAsset = Object.values(timeline.assets).find((asset) => asset.kind !== "audio" && asset.width !== undefined && asset.height !== undefined);
  const width = canvasAsset?.width ?? 1280;
  const height = canvasAsset?.height ?? 720;
  const scale = zoom === "fit" ? Math.min(size.width / width, size.height / height) : zoom;

  useEffect(() => {
    const element = viewport.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let request = 0;
    let previousFrame: number | null = null;
    let expectedTime = useEditorStore.getState().playheadMs;
    const tick = (frame: number): void => {
      const store = useEditorStore.getState();
      if (!store.isPlaying) return;
      // Give a user seek a render at its requested position before sampling media again.
      if (store.playheadMs !== expectedTime) {
        videoClock.current = null;
        expectedTime = store.playheadMs;
        previousFrame = frame;
        request = requestAnimationFrame(tick);
        return;
      }
      const activeLayers = resolvePlaybackLayers(store.timeline, store.playheadMs, useUiStore.getState().hiddenTrackIds);
      const players = Array.from(viewport.current?.querySelectorAll<HTMLElement>("[data-player-track]") ?? []);
      const singleVideo = activeLayers.length === 1 && activeLayers[0]?.track.kind === "video"
        && assetById(store.timeline, activeLayers[0].clip.assetId)?.kind === "video";
      let mediaLeadMs: number | undefined;
      const waiting = activeLayers.some(({ clip, track, sourceTimeMs }) => {
        if (assetById(store.timeline, clip.assetId)?.kind === "image") return false;
        const player = players.find((element) => element.dataset.playerTrack === track.id);
        const media = player?.querySelector<HTMLMediaElement>('[data-player-live="true"]');
        if (player?.dataset.activeClip !== clip.id || !media || media.readyState < 2 || media.seeking) return true;
        if (singleVideo && !media.ended && !media.paused) {
          const boundary = Math.min(clip.start + clip.duration, nextCut(cutStarts, store.playheadMs) ?? Infinity);
          mediaLeadMs = Math.min(media.currentTime * 1000 - sourceTimeMs, boundary - store.playheadMs);
        }
        return false;
      });
      // A lone video can recover on its own. Other layers must wait together
      // to avoid racing ahead of the track that is buffering.
      buffering.current = waiting && !singleVideo;
      if (buffering.current) {
        for (const player of players) {
          const media = player.querySelector<HTMLMediaElement>('[data-player-live="true"]');
          if (media && !media.paused) media.pause();
        }
      }
      const next = advancePlayback({ at: store.playheadMs, previousFrame, frame, duration: indexedTimelineDuration(store.timeline), buffering: waiting, mediaLeadMs });
      previousFrame = frame;
      expectedTime = next.time;
      const solo = activeLayers[0];
      videoClock.current = solo && mediaLeadMs !== undefined ? {clip: solo.clip, at: next.time} : null;
      if (next.time !== store.playheadMs) store.setPlayhead(next.time);
      if (next.ended) {
        store.pause();
        return;
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(request);
      buffering.current = false;
      videoClock.current = null;
    };
  }, [playing, cutStarts]);

  return (
    <div className="player-compositor" style={{ position: "relative", height: fill ? "100%" : undefined, aspectRatio: fill ? undefined : "16 / 9", maxWidth: fill ? undefined : 960, marginBottom: 0 }}>
      <div ref={viewport} className="player-viewport" style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#000" }}>
        <div className="player-stage" data-canvas-width={width} data-canvas-height={height} style={{ position: "absolute", left: "50%", top: "50%", width, height, transformOrigin: "center", transform: `translate(-50%, -50%) scale(${scale})` }}>
          {visibleTracks.map((track, index) => <TrackPlayer key={`${sessionId}:${track.id}`} track={track} order={index} buffering={buffering} videoClock={videoClock} muted={muted.includes(track.id)} onMediaError={onError} onMediaReady={onReady} />)}
        </div>
        {visualLayers.length === 0 && <div className="player-message">Gap — no clip under the playhead</div>}
        {missing !== undefined && <div className="player-message player-message-warning">Media not local yet: {missing.clip.assetId}</div>}
        {activeErrors.length > 0 && <div role="alert" className="player-message player-message-warning">{activeErrors.map(error => <p key={error.trackId}>{error.message}</p>)}</div>}
      </div>
    </div>
  );
}
