import type { Timeline } from "@cutroom/engine";
import type { Commit } from "../vcs";

/**
 * Count current and committed clip uses of a source.
 *
 * A file is referenced if any clip in the *current* timeline uses it, or if
 * any commit's snapshot contains a clip that uses it — a commit is a
 * snapshot of a timeline, so its clips still point at the same media. An
 * asset sitting in the timeline's asset registry with no clip using it is
 * not counted: the registry is a catalogue, not a clip use. These counts
 * exclude Undo/Redo and library ownership, so they do not authorize deleting
 * a stored file. Ordinary clip deletion always retains the source.
 */

export interface AssetReferences {
  /** Clips in the current timeline that use the asset. */
  readonly clips: number;
  /** Commits whose snapshot contains a clip that uses the asset. */
  readonly commits: number;
  /** Total references across both. */
  readonly total: number;
}

export function countAssetReferences(
  assetId: string,
  timeline: Timeline,
  commits: Readonly<Record<string, Commit>> = {},
): AssetReferences {
  let clips = 0;
  for (const clip of Object.values(timeline.clips)) {
    if (clip.assetId === assetId) clips += 1;
  }
  let commitCount = 0;
  for (const commit of Object.values(commits)) {
    const used = Object.values(commit.timeline.clips).some(
      (clip) => clip.assetId === assetId,
    );
    if (used) commitCount += 1;
  }
  return { clips, commits: commitCount, total: clips + commitCount };
}

export function isAssetReferenced(
  assetId: string,
  timeline: Timeline,
  commits: Readonly<Record<string, Commit>> = {},
): boolean {
  return countAssetReferences(assetId, timeline, commits).total > 0;
}

/**
 * Assets with no current or committed clip use. Undo/Redo and library
 * ownership are excluded; this is not a safe-to-delete file list.
 */
export function unreferencedAssets(
  timeline: Timeline,
  commits: Readonly<Record<string, Commit>> = {},
): string[] {
  const all = new Set<string>(Object.keys(timeline.assets));
  for (const commit of Object.values(commits)) {
    for (const id of Object.keys(commit.timeline.assets)) all.add(id);
  }
  return [...all].filter(
    (assetId) => !isAssetReferenced(assetId, timeline, commits),
  );
}
