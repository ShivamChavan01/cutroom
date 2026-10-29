import { create } from "zustand";

export interface Waveform {
  readonly durationMs: number;
  readonly peaks: Float32Array;
  readonly max: number;
}

export function audioPeaks(channels: readonly Float32Array[], sampleRate: number): Waveform {
  const length = channels[0]?.length ?? 0;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || length === 0 || channels.some((channel) => channel.length !== length)) throw new Error("No audio samples available.");
  const count = Math.min(length, 60_000, Math.max(1, Math.ceil(length / sampleRate * 100)));
  const peaks = new Float32Array(count);
  let max = 0;
  for (let bucket = 0; bucket < count; bucket++) {
    const start = Math.floor(bucket * length / count);
    const end = Math.floor((bucket + 1) * length / count);
    let peak = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        const sample = channel[i] ?? 0;
        if (Number.isFinite(sample)) peak = Math.max(peak, Math.min(1, Math.abs(sample)));
      }
    }
    peaks[bucket] = peak;
    max = Math.max(max, peak);
  }
  return { durationMs: length / sampleRate * 1000, peaks, max };
}

export function waveformPath(waveform: Waveform, { inPoint, duration, width, volume }: { inPoint: number; duration: number; width: number; volume: number }): string {
  if (![inPoint, duration, width, volume].every(Number.isFinite) || inPoint < 0 || duration <= 0 || width <= 0 || waveform.durationMs <= 0 || waveform.peaks.length === 0) return "";
  const bars = Math.max(1, Math.min(2000, Math.ceil(width / 3)));
  const commands: string[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const from = Math.floor((inPoint + duration * bar / bars) / waveform.durationMs * waveform.peaks.length);
    const to = Math.ceil((inPoint + duration * (bar + 1) / bars) / waveform.durationMs * waveform.peaks.length);
    let peak = 0;
    for (let index = Math.max(0, from); index < Math.min(waveform.peaks.length, Math.max(from + 1, to)); index++) peak = Math.max(peak, waveform.peaks[index] ?? 0);
    const height = waveform.max === 0 ? 0 : peak / waveform.max * Math.min(1, Math.max(0, volume)) * 10;
    const x = (bar + 0.5) * width / bars;
    commands.push(`M${x.toFixed(1)},${(12 - height).toFixed(1)}V${(12 + height).toFixed(1)}`);
  }
  return commands.join("");
}

const MAX_BYTES = 128 * 1024 * 1024;
const MAX_DURATION_MS = 20 * 60 * 1000;

export async function decodeWaveform(url: string, signal: AbortSignal): Promise<Waveform> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Could not read audio for the waveform.");
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Waveforms support files up to 128 MB.");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new Error("Waveforms support files up to 128 MB.");
  signal.throwIfAborted();
  // Offline decoding resamples for visualization without routing or changing playback.
  const context = new OfflineAudioContext(1, 1, 8000);
  const buffer = await context.decodeAudioData(bytes);
  signal.throwIfAborted();
  if (buffer.duration * 1000 > MAX_DURATION_MS) throw new Error("Waveforms support sources up to 20 minutes.");
  return audioPeaks(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)), buffer.sampleRate);
}

type Entry = { readonly url: string } & (
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly waveform: Waveform }
  | { readonly status: "error"; readonly message: string }
);
export const useWaveforms = create<ReadonlyMap<string, Entry>>(() => new Map());

function publish(assetId: string, entry: Entry) {
  useWaveforms.setState((previous) => {
    const next = new Map(previous);
    next.delete(assetId);
    next.set(assetId, entry);
    // In-flight jobs must stay discoverable so repeated clips share their work.
    for (const [id, value] of next) {
      if (next.size <= 64) break;
      if (value.status !== "loading" && id !== assetId) next.delete(id);
    }
    return next;
  }, true);
}

let queue: Promise<void> = Promise.resolve();
export function ensureWaveform(assetId: string, url: string, { bytes, duration }: { bytes?: number; duration: number }): void {
  if (useWaveforms.getState().get(assetId)?.url === url) return;
  if ((bytes ?? 0) > MAX_BYTES || duration > MAX_DURATION_MS) {
    publish(assetId, { url, status: "error", message: "Waveform unavailable: limit is 128 MB and 20 minutes per source." });
    return;
  }
  const loading: Entry = { url, status: "loading" };
  publish(assetId, loading);
  queue = queue.then(async () => {
    if (useWaveforms.getState().get(assetId) !== loading) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const waveform = await decodeWaveform(url, controller.signal);
      if (useWaveforms.getState().get(assetId) === loading) publish(assetId, { url, status: "ready", waveform });
    } catch {
      if (useWaveforms.getState().get(assetId) === loading) publish(assetId, { url, status: "error", message: "Waveform unavailable: no decodable audio, unsupported format, or decoding timed out." });
    } finally { clearTimeout(timer); }
  });
}
