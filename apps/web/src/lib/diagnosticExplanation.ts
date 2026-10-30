import type {Diagnostic, Timeline} from "@cutroom/engine";

export function explainDiagnostic(timeline: Timeline, finding: Diagnostic): {location: string; explanation: string} {
  const clips = finding.clipIds.flatMap(id => {const clip = timeline.clips[id]; return clip === undefined ? [] : [clip];}).sort((a, b) => a.start - b.start);
  const first = clips[0], next = clips[1];
  const track = timeline.tracks.find(item => item.id === first?.trackId);
  const trackLabel = track === undefined ? "" : ` on ${track.kind} track ${track.name}`;
  let location = finding.where === undefined ? "Project media" : `${(finding.where / 1000).toFixed(2)}s${trackLabel}`;
  if (finding.rule === "gap" && first !== undefined && next !== undefined && first.trackId === next.trackId) {
    const start = first.start + first.duration;
    if (next.start > start) {
      location = `${(start / 1000).toFixed(2)}s to ${(next.start / 1000).toFixed(2)}s${trackLabel}`;
      return {location, explanation: `${((next.start - start) / 1000).toFixed(2)} seconds without a clip on this track. Other tracks may still cover it. Keep the pause if deliberate; otherwise review the adjacent cuts.`};
    }
  }
  const explanations: Readonly<Record<string, string>> = {
    overlap: "These clips share time on one track. Preview which content is visible and decide whether that overlap belongs in the cut.",
    "missing-media": "A clip references media absent from the timeline metadata. Review the source before delivery. This check does not test network or decoder availability.",
    "flash-frame": "This clip is below the structural duration threshold. Watch the cut to judge whether the brief shot is intentional.",
    "trim-past-source": "The source trim exceeds the recorded media duration. Check the source and trim before delivery.",
    "zero-length": "This clip has no playable duration. Review the edit before delivery.",
    "unused-asset": "This media is not used by the current cut. Keeping alternate footage may be intentional.",
  };
  return {location, explanation: explanations[finding.rule] ?? "Review this structural finding in context. The checker cannot decide editorial intent."};
}
