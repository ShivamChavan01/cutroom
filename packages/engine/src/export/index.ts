import { type Timeline } from "../model";
import { toCutroomFile } from "./cutroom.js";
import { toEdl } from "./edl.js";
import { toFcpxml } from "./fcpxml.js";
import { stringifyOTIO } from "../otio.js";

/**
 * The export formats the editor can write.
 *
 * Each one is a real, documented interchange format that other tools
 * actually open — not a renamed copy of the same JSON. The registry is the
 * single list the UI renders, so adding a format is one entry plus a
 * serializer.
 */
export interface ExportFormat {
  readonly id: string;
  readonly label: string;
  readonly extension: string;
  readonly mime: string;
  /** Which tools open this. Shown in the menu so nobody has to guess. */
  readonly opens: string;
  readonly description: string;
  serialize(timeline: Timeline): string;
}

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  {
    id: "otio",
    label: "OpenTimelineIO",
    extension: ".otio",
    mime: "application/json",
    opens: "Premiere, Resolve, Blender",
    description:
      "The interchange format built for editorial pipelines. Carries tracks, assets and clip structure.",    serialize: (timeline) => stringifyOTIO(timeline),
  },
  {
    id: "fcpxml",
    label: "Final Cut Pro XML",
    extension: ".fcpxml",
    mime: "application/xml",
    opens: "Final Cut Pro, Premiere, Resolve",
    description:
      "What Final Cut writes. One file opens in the whole professional toolchain. Gaps between clips on a track are dropped — Final Cut has no gaps.",
    serialize: (timeline) => toFcpxml(timeline),
  },
  {
    id: "edl",
    label: "EDL (CMX3600)",
    extension: ".edl",
    mime: "text/plain",
    opens: "Premiere, Resolve, Avid, every NLE",
    description:
      "The universal cut list. Simple text, no effects and no asset links — the fallback that always opens.",
    serialize: (timeline) => toEdl(timeline),
  },
  {
    id: "cutroom",
    label: "Cutroom timeline",
    extension: ".cutroom.json",
    mime: "application/json",
    opens: "Cutroom",
    description:
      "Lossless: assets, tracks and clip ids all survive. The only format that round-trips everything.",
    serialize: (timeline) => toCutroomFile(timeline),
  },
];

export function findExportFormat(id: string): ExportFormat | undefined {
  return EXPORT_FORMATS.find((format) => format.id === id);
}

export * from "./cutroom.js";
export * from "./edl.js";
export * from "./fcpxml.js";
