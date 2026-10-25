import { type Track, clipsOnTrack, timelineDuration } from "@cutroom/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { advancePlayback, clipTransform, nextClip, playbackGain, resolveActiveClip, resolvePlaybackLayers } from "../lib/playback";
import { resolveAssetUrl, useAssetUrls } from "../lib/assets";
import { decideSwap, isSameSource, otherSide, type Side } from "../lib/swap";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";

const DRIFT_TOLERANCE_MS = 250;
const PRELOAD_AHEAD_MS = 1_000;

interface WarmState {
  readonly side: Side;
  readonly assetId: string;
}

declare global {
  interface Window {
    __stalls?: { mode: string; ms: number }[];
  }
}

function TrackPlayer({ track, order, muted, onError, onReady }: {
  readonly track: Track;
  readonly order: number;
  readonly muted: boolean;
  readonly onError: (message: string) => void;
  readonly onReady: () => void;
}) {
  const timeline = useEditorStore((state) => state.timeline);
  const at = useEditorStore((state) => state.playheadMs);
  const playing = useEditorStore((state) => state.isPlaying);
  const clips = useMemo(() => clipsOnTrack(timeline, track.id), [timeline, track.id]);
  const active = resolveActiveClip(clips, at);
  const asset = active === null ? undefined : timeline.assets[active.clip.assetId];
  const source = useAssetUrls((urls) => active === null ? undefined : urls.get(active.clip.assetId));
  const slots = useRef<Record<Side, HTMLMediaElement | null>>({ a: null, b: null });
  const live = useRef<Side>("a");
  const [visibleSide, setVisibleSide] = useState<Side>("a");
  const loaded = useRef<Record<Side, string | null>>({ a: null, b: null });
  const warm = useRef<WarmState | null>(null);
  const swapStartedAt = useRef(0);
  const preload = typeof window === "undefined" || new URLSearchParams(window.location.search).get("preload") !== "off";
  const setA = useCallback((element: HTMLMediaElement | null) => { slots.current.a = element; }, []);
  const setB = useCallback((element: HTMLMediaElement | null) => { slots.current.b = element; }, []);

  useEffect(() => {
    const pauseSlots = (): void => {
      slots.current.a?.pause();
      slots.current.b?.pause();
    };
    const start = (element: HTMLMediaElement): void => {
      if (!useEditorStore.getState().isPlaying) {
        element.pause();
        return;
      }
      if (!element.paused) return;
      void element.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        onError(error instanceof Error ? error.message : "Playback could not start");
      });
    };
    const current = resolveActiveClip(clips, at);
    if (current === null || source === undefined || timeline.assets[current.clip.assetId]?.kind === "image") {
      pauseSlots();
      return;
    }

    const desired = current.clip;
    let side = live.current;
    const candidate = warm.current;
    const warmElement = candidate === null ? null : slots.current[candidate.side];
    const decision = decideSwap(desired.assetId, {
      liveSide: side,
      loadedAsset: loaded.current,
      warm: candidate === null ? null : {
        ...candidate,
        elementReady: warmElement !== null && warmElement.readyState >= 3 && isSameSource(warmElement.src, source),
      },
    });
    if (decision.kind === "flip") {
      slots.current[side]?.pause();
      side = decision.to;
      live.current = side;
      loaded.current[side] = desired.assetId;
      warm.current = null;
      swapStartedAt.current = performance.now();
      setVisibleSide(side);
    }
    const element = slots.current[side];
    if (element === null) return;
    element.onseeked = () => {
      const store = useEditorStore.getState();
      if (store.isPlaying || live.current !== side) return;
      const latest = resolveActiveClip(clipsOnTrack(store.timeline, track.id), store.playheadMs);
      if (latest?.clip.assetId !== desired.assetId) return;
      const targetTime = latest.sourceTimeMs / 1000;
      if (Math.abs(element.currentTime - targetTime) > 0.001) element.currentTime = targetTime;
    };
    const hidden = slots.current[otherSide(side)];
    hidden?.pause();
    if (hidden !== null) hidden.volume = 0;
    element.volume = muted ? 0 : playbackGain(desired, track);

    if (!isSameSource(element.src, source)) {
      loaded.current[side] = desired.assetId;
      swapStartedAt.current = performance.now();
      element.src = source;
      element.onloadedmetadata = () => {
        const store = useEditorStore.getState();
        const latest = resolveActiveClip(clipsOnTrack(store.timeline, track.id), store.playheadMs);
        if (latest?.clip.assetId !== desired.assetId) return;
        element.currentTime = latest.sourceTimeMs / 1000;
        start(element);
      };
    } else {
      const sourceTime = current.sourceTimeMs / 1000;
      const tolerance = playing ? DRIFT_TOLERANCE_MS : 1;
      if (!element.seeking && element.readyState >= 1 && Math.abs(element.currentTime - sourceTime) * 1000 > tolerance) {
        element.currentTime = sourceTime;
      }
      start(element);
    }

    const next = nextClip(clips, desired);
    if (!preload || !playing || next === null || desired.start + desired.duration - at >= PRELOAD_AHEAD_MS) return;
    if (timeline.assets[next.assetId]?.kind === "image") return;
    const nextSource = resolveAssetUrl(next.assetId);
    const hiddenSide = otherSide(side);
    const target = slots.current[hiddenSide];
    if (target === null || nextSource === undefined) return;
    if (warm.current?.side === hiddenSide && warm.current.assetId === next.assetId && isSameSource(target.src, nextSource)) return;
    warm.current = { side: hiddenSide, assetId: next.assetId };
    target.src = nextSource;
    target.onloadedmetadata = () => {
      target.currentTime = next.inPoint / 1000;
    };
  }, [at, playing, clips, source, timeline, track, muted, preload, onError]);

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
    if (side === live.current && active !== null && !image) onError(`Could not decode ${asset?.name ?? active.clip.assetId}`);
  };

  return (
    <div data-player-track={track.id} data-active-clip={active?.clip.id} style={{ position: "absolute", inset: 0, zIndex: order, pointerEvents: "none" }}>
      {track.kind === "audio" ? (
        <>
          <audio ref={setA} preload="auto" onPlaying={onPlaying} onLoadedData={onReady} onError={() => failed("a")} />
          <audio ref={setB} preload="auto" onPlaying={onPlaying} onError={() => failed("b")} />
        </>
      ) : (
        <>
          <video ref={setA} style={mediaStyle("a")} playsInline preload="auto" onPlaying={onPlaying} onLoadedData={onReady} onError={() => failed("a")} />
          <video ref={setB} style={mediaStyle("b")} playsInline preload="auto" onPlaying={onPlaying} onLoadedData={onReady} onError={() => failed("b")} />
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
  const at = useEditorStore((state) => state.playheadMs);
  const playing = useEditorStore((state) => state.isPlaying);
  const hidden = useUiStore((state) => state.hiddenTrackIds);
  const muted = useUiStore((state) => state.mutedTrackIds);
  const urls = useAssetUrls();
  const viewport = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 960, height: 540 });
  const [error, setError] = useState<string | null>(null);
  const onError = useCallback((message: string) => {
    setError(message);
    useEditorStore.getState().pause();
  }, []);
  const onReady = useCallback(() => setError(null), []);
  const visibleTracks = timeline.tracks.filter((track) => !hidden.includes(track.id));
  const layers = resolvePlaybackLayers(timeline, at, hidden);
  const visualLayers = layers.filter((layer) => layer.track.kind === "video");
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
    const tick = (frame: number): void => {
      const store = useEditorStore.getState();
      if (!store.isPlaying) return;
      const next = advancePlayback({ at: store.playheadMs, previousFrame, frame, duration: timelineDuration(store.timeline) });
      previousFrame = frame;
      store.setPlayhead(next.time);
      if (next.ended) {
        store.pause();
        return;
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing]);

  return (
    <div className="player-compositor" style={{ position: "relative", height: fill ? "100%" : undefined, aspectRatio: fill ? undefined : "16 / 9", maxWidth: fill ? undefined : 960, marginBottom: 0 }}>
      <div ref={viewport} className="player-viewport" style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#000" }}>
        <div className="player-stage" data-canvas-width={width} data-canvas-height={height} style={{ position: "absolute", left: "50%", top: "50%", width, height, transformOrigin: "center", transform: `translate(-50%, -50%) scale(${scale})` }}>
          {visibleTracks.map((track, index) => <TrackPlayer key={track.id} track={track} order={index} muted={muted.includes(track.id)} onError={onError} onReady={onReady} />)}
        </div>
        {visualLayers.length === 0 && <div className="player-message">Gap — no clip under the playhead</div>}
        {missing !== undefined && <div className="player-message player-message-warning">Media not local yet: {missing.clip.assetId}</div>}
        {error !== null && <div role="alert" className="player-message player-message-warning">{error}</div>}
      </div>
    </div>
  );
}
