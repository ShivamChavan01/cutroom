import { useEffect, useMemo, useState } from "react";
import type { Asset } from "@cutroom/engine";
import { useAssetUrls } from "../lib/assets";
import { ensureWaveform, useWaveforms, waveformPath, type Waveform } from "../lib/media/waveform";
import type { TimelineWindow } from "../lib/timelineViewport";
import { useUiStore } from "../uiStore";

interface Props {
  readonly asset: Asset;
  readonly trackId: string;
  readonly start: number;
  readonly inPoint: number;
  readonly duration: number;
  readonly volume: number;
  readonly pxPerSecond: number;
  readonly visibleWindow: TimelineWindow | undefined;
}

export function ClipWaveform({ asset, trackId, start, inPoint, duration, volume, pxPerSecond, visibleWindow }: Props) {
  const url = useAssetUrls((urls) => urls.get(asset.id));
  const entry = useWaveforms((entries) => entries.get(asset.id));
  const muted = useUiStore((state) => state.mutedTrackIds.includes(trackId));
  const [retained, setRetained] = useState<{ assetId: string; url: string; waveform: Waveform } | null>(null);
  useEffect(() => {
    if (entry?.status === "ready" && entry.url === url) setRetained({ assetId: asset.id, url: entry.url, waveform: entry.waveform });
  }, [asset.id, entry, url]);
  useEffect(() => {
    if (url !== undefined) ensureWaveform(asset.id, url, { duration: asset.duration, ...(asset.bytes === undefined ? {} : { bytes: asset.bytes }) });
  }, [asset.id, asset.duration, asset.bytes, url]);
  const from = Math.max(0, (visibleWindow?.start ?? start) - start);
  const to = Math.min(duration, (visibleWindow?.end ?? start + duration) - start);
  const width = Math.max(0, (to - from) / 1000 * pxPerSecond);
  const waveform = entry !== undefined && entry.url === url && entry.status === "ready" ? entry.waveform : retained?.assetId === asset.id && retained.url === url ? retained.waveform : undefined;
  const path = useMemo(() => waveform === undefined ? "" : waveformPath(waveform, { inPoint: inPoint + from, duration: to - from, width, volume }), [waveform, inPoint, from, to, width, volume]);
  if (url === undefined || width <= 0) return null;
  const current = entry?.url === url ? entry : undefined;
  const title = current?.status === "error" ? current.message : waveform === undefined ? "Generating audio waveform…" : waveform.max === 0 ? "Silent audio" : "Audio waveform · source-normalized peaks, clip volume applied";
  return <div className={`clip-waveform ${trackId.startsWith("a") ? "is-audio" : "is-embedded"}`} title={title} data-waveform-state={waveform === undefined ? current?.status ?? "loading" : "ready"} style={{ opacity: muted ? 0.35 : 1 }}>
    {waveform === undefined ? <span className="clip-waveform-status">{current?.status === "error" ? "Waveform unavailable" : "Analyzing audio…"}</span> : <svg role="img" aria-label="Audio waveform" viewBox={`0 0 ${width} 24`} preserveAspectRatio="none" data-source-in={inPoint + from} data-source-duration={to - from} style={{ position: "absolute", left: from / 1000 * pxPerSecond, width, height: "100%" }}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>}
  </div>;
}
