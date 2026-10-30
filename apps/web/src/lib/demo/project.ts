import { applyOp, createHistory, current, emptyTimeline, makeClip, record, type History, type Op, type Timeline } from "@cutroom/engine";
import { checkout, commit, createBranch, createRepo, type Repo } from "../vcs";

export const DEMO_VIDEO_ID = "9f31ed8bd64347bef05d05bca7a8c6eab585c0d7cdf0d55f9fc6ae577f400d99";
export const DEMO_AUDIO_ID = "8bc2e33bfa5e8c6907cf769f9f333c5151cd6cfcc8abcbaf37798008268e2c32";
export const DEMO_BRANCH = "alternate";

/** Build ordinary history and commits through the same reducer as user edits. */
export function createDemoProject(): {history: History; repo: Repo} {
  let base: Timeline = {
    ...emptyTimeline("Motion study"), fps: 30,
    assets: {
      [DEMO_VIDEO_ID]: {id: DEMO_VIDEO_ID, kind: "video" as const, duration: 8000, width: 960, height: 540, name: "motion.mp4", mimeType: "video/mp4"},
      [DEMO_AUDIO_ID]: {id: DEMO_AUDIO_ID, kind: "audio" as const, duration: 8000, name: "pulse.wav", mimeType: "audio/wav"},
    },
  };
  let repo = createRepo(base, "Demo");
  for (const [id, start, inPoint, duration] of [
    ["opening", 0, 0, 2000], ["middle", 2000, 2000, 2000], ["ending", 5000, 4000, 2000],
  ] as const) {
    base = applyOp(base, {type: "addClip", clip: makeClip({id, trackId: "v1", assetId: DEMO_VIDEO_ID, start, inPoint, duration, volume: 0})});
  }
  base = applyOp(base, {type: "addClip", clip: makeClip({id: "score", trackId: "a1", assetId: DEMO_AUDIO_ID, start: 0, inPoint: 0, duration: 7000, volume: 0.65})});
  repo = commit(repo, base, "Assemble three shots and a sound bed", "Demo");
  repo = createBranch(repo, DEMO_BRANCH);
  let history = createHistory(base);
  for (const op of [
    {type: "moveClip", clipId: "middle", start: 3000},
    {type: "trimClip", clipId: "opening", inPoint: 100, duration: 1800},
  ] satisfies Op[]) history = record(history, op, "Editor A");
  repo = commit(repo, current(history), "Give the middle shot more breathing room", "Editor A");
  repo = checkout(repo, DEMO_BRANCH);
  const alternate = applyOp(base, {type: "moveClip", clipId: "ending", start: 4000});
  repo = commit(repo, alternate, "Bring the ending forward", "Editor B");
  repo = checkout(repo, "main");
  // Stable fixture dates make reset and regression comparisons reproducible.
  repo = {...repo, commits: Object.fromEntries(Object.values(repo.commits).map((entry, index) => [entry.id, {...entry, at: Date.UTC(2026, 9, 1) + index * 60000}]))};
  return {history, repo};
}

export function demoMediaUrls(baseUrl: string): ReadonlyMap<string, string> {
  return new Map([[DEMO_VIDEO_ID, `${baseUrl}demo/motion.mp4`], [DEMO_AUDIO_ID, `${baseUrl}demo/pulse.wav`]]);
}
