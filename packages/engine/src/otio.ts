import { type Asset, type Clip, type Timeline, clipsOnTrack } from "./model";

/**
 * OpenTimelineIO export — the workflow-interchange bridge.
 *
 * Our timeline is our own format; `.otio` is the format Premiere, Resolve,
 * Blender, Kdenlive and the rest of the NLE world reads. Exporting to it
 * means a merged, linted, branched timeline can leave this prototype and
 * be finished in a real editor. That is the whole point of the workflow
 * layer: this is where decisions live, other tools render them.
 *
 * What maps cleanly: tracks, clips, in/out points (OTIO `source_range`),
 * and positions (OTIO expresses position by adjacency, so gaps become
 * explicit `Gap` objects). What OTIO has no clean home for: our
 * content-addressed asset ids and per-clip volume — those ride in
 * `metadata.cutroom` rather than being forced into a field that means
 * something else.
 *
 * Round-trip is lossless for gap-free timelines; import drops gaps (our
 * model has no gap representation) but reconstructs every clip's start,
 * in-point and duration exactly. Both behaviors are tested.
 */

interface OtioRationalTime {
  readonly OTIO_SCHEMA: "RationalTime.1";
  readonly rate: number;
  readonly value: number;
}

interface OtioTimeRange {
  readonly OTIO_SCHEMA: "TimeRange.1";
  readonly start_time: OtioRationalTime;
  readonly duration: OtioRationalTime;
}

interface OtioExternalReference {
  readonly OTIO_SCHEMA: "ExternalReference.1";
  readonly target_url: string;
  readonly available_range: OtioTimeRange;
}

interface OtioClip {
  readonly OTIO_SCHEMA: "Clip.1";
  readonly name: string;
  readonly source_range: OtioTimeRange;
  readonly media_reference: OtioExternalReference;
  readonly metadata: { readonly cutroom: Record<string, unknown> };
}

interface OtioGap {
  readonly OTIO_SCHEMA: "Gap.1";
  readonly name: string;
  readonly source_range: OtioTimeRange;
}

interface OtioTrack {
  readonly OTIO_SCHEMA: "Track.1";
  readonly kind: "Video" | "Audio";
  readonly name: string;
  readonly children: readonly (OtioClip | OtioGap)[];
}

interface OtioStack {
  readonly OTIO_SCHEMA: "Stack.1";
  readonly name: string;
  readonly children: readonly OtioTrack[];
}

export interface OtioTimeline {
  readonly OTIO_SCHEMA: "Timeline.1";
  readonly name: string;
  readonly global_start_time: OtioRationalTime;
  readonly tracks: OtioStack;
  readonly metadata: { readonly cutroom: Record<string, unknown> };
}

/**
 * Rational time at rate 1000 ticks per second. MS are exactly
 * representable, so round-trips carry no rounding error, and rate stays
 * honest (it really is milliseconds-per-second).
 */
const RATE = 1000;
const msToRational = (ms: number): OtioRationalTime => ({
  "OTIO_SCHEMA": "RationalTime.1",
  rate: RATE,
  value: Math.round(ms),
});
const range = (startMs: number, durationMs: number): OtioTimeRange => ({
  "OTIO_SCHEMA": "TimeRange.1",
  start_time: msToRational(startMs),
  duration: msToRational(durationMs),
});
const rationalToMs = (time: OtioRationalTime): number =>
  Math.round((time.value * 1000) / time.rate);

export function toOTIO(timeline: Timeline): OtioTimeline {
  const tracks: OtioTrack[] = timeline.tracks.map((track) => {
    const children: (OtioClip | OtioGap)[] = [];
    // Position in OTIO is expressed by adjacency, so anything not covered
    // by the clip before it becomes an explicit Gap.
    let cursorMs = 0;
    for (const clip of clipsOnTrack(timeline, track.id)) {
      if (clip.start > cursorMs) {
        children.push({
          OTIO_SCHEMA: "Gap.1",
          name: "",
          source_range: range(cursorMs, clip.start - cursorMs),
        });
      }
      children.push({
        OTIO_SCHEMA: "Clip.1",
        name: clip.id,
        source_range: range(clip.inPoint, clip.duration),
        media_reference: {
          OTIO_SCHEMA: "ExternalReference.1",
          // Assets are content-addressed; the playable URL lives in the
          // app's asset registry, not in this structure.
          target_url: "",
          available_range: range(
            0,
            timeline.assets[clip.assetId]?.duration ?? clip.outPoint,
          ),
        },
        metadata: {
          cutroom: { id: clip.id, assetId: clip.assetId, volume: clip.volume },
        },
      });
      cursorMs = clip.start + clip.duration;
    }
    return {
      OTIO_SCHEMA: "Track.1",
      kind: track.kind === "audio" ? "Audio" : "Video",
      name: track.id,
      children,
    };
  });

  return {
    OTIO_SCHEMA: "Timeline.1",
    name: timeline.id,
    global_start_time: msToRational(0),
    tracks: { OTIO_SCHEMA: "Stack.1", name: "Tracks", children: tracks },
    metadata: { cutroom: { id: timeline.id } },
  };
}

/** Unlabelled OTIO (no cutroom metadata): fall back to a name-derived id. */
function importAssetId(clip: OtioClip, metadata: Record<string, unknown> | undefined): string {
  const recorded = metadata?.assetId;
  if (typeof recorded === "string") return recorded;
  const url = clip.media_reference?.target_url;
  if (typeof url === "string" && url.length > 0) {
    return url.split("/").at(-1) ?? url;
  }
  return "unknown-asset";
}

export function fromOTIO(doc: OtioTimeline): Timeline {
  const clips: Record<string, Clip> = {};
  const assets: Record<string, Asset> = {};
  const trackKinds = new Map<string, "video" | "audio">();

  for (const track of doc.tracks.children) {
    trackKinds.set(track.name, track.kind === "Audio" ? "audio" : "video");
    let cursorMs = 0;
    for (const child of track.children) {
      const duration = rationalToMs(child.source_range.duration);
      if (child.OTIO_SCHEMA === "Gap.1") {
        // Our model cannot represent a gap; step the cursor past it.
        cursorMs += duration;
        continue;
      }
      const inPoint = rationalToMs(child.source_range.start_time);
      const assetId = importAssetId(
        child,
        child.metadata?.cutroom as Record<string, unknown> | undefined,
      );
      const id = child.name;
      const volume = child.metadata?.cutroom?.volume;
      clips[id] = {
        id,
        trackId: track.name,
        assetId,
        start: cursorMs,
        inPoint,
        duration,
        outPoint: inPoint + duration,
        volume: typeof volume === "number" ? volume : 1,
      };
      const available = rationalToMs(
        child.media_reference.available_range.duration,
      );
      if (!(assetId in assets) && available > 0) {
        assets[assetId] = {
          id: assetId,
          kind: track.kind === "Audio" ? "audio" : "video",
          duration: available,
        };
      }      cursorMs += duration;
    }
  }

  return {
    id: typeof doc.metadata?.cutroom?.id === "string"
      ? doc.metadata.cutroom.id
      : (doc.name ?? "imported"),
    clips,
    tracks: [...trackKinds].map(([id, kind]) => ({
      id,
      kind,
      name: id,
      muted: false,
    })),
    assets,
  };
}

/** Serialize to the `.otio` JSON text a real editor reads. */
export function stringifyOTIO(timeline: Timeline): string {
  return JSON.stringify(toOTIO(timeline), null, 2);
}
