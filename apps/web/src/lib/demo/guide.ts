import {isUnchanged, lint, type Timeline} from "@cutroom/engine";
import type {EditorTab, RailItem} from "../../uiStore";
import type {DiffOverlay} from "../../vcsStore";
import {assertMergeCurrent, type PendingMerge} from "../mergeSession";
import {head, type Repo} from "../vcs";
import {createDemoProject} from "./project";

export type GuideKind = "intro" | "versions" | "compare" | "conflict" | "resolved" | "merged" | "findings" | "changed" | "return" | "comparison";
interface GuideInput {
  readonly repo: Repo; readonly timeline: Timeline; readonly pending: PendingMerge | null;
  readonly diff: DiffOverlay | null; readonly rail: RailItem; readonly tab: EditorTab;
}
export interface GuideView {
  readonly kind: GuideKind; readonly step: number; readonly title: string;
  readonly text: string; readonly label: string;
}

const sample = createDemoProject();

function completedSample(repo: Repo): boolean {
  const visited = new Set<string>();
  const queue = [head(repo).id];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    const commit = repo.commits[id];
    if (commit === undefined) continue;
    queue.push(...commit.parents);
  }
  return visited.has("c2") && visited.has("c3");
}

/** Guide position is a view of editor state, never a second operation history. */
export function describeDemo({repo, timeline, pending, diff, rail, tab}: GuideInput): GuideView {
  if (pending !== null) {
    try {assertMergeCurrent(pending, repo, timeline);}
    catch {return {kind: "changed", step: 4, title: "Your cut changed during this merge", text: "Your new edits are safe. Cancel this pending merge below, then start it again to include them.", label: "Review pending merge"};}
    const hasOverlap = pending.result.conflicts.some(conflict => conflict.kind === "overlap");
    return pending.result.clean
      ? {kind: "resolved", step: 5, title: "Your choice is recorded", text: "No merge conflicts remain. Enter a message and commit below to save the combined cut. Then check its timing.", label: "Review merge"}
      : {kind: "conflict", step: 4, title: hasOverlap ? "Both edits need the same moment" : "These editing decisions need your review", text: hasOverlap ? "Independent timing decisions overlap in the combined cut. Review the clips below and choose what stays; nothing moves automatically." : "These versions disagree on content or settings. Review each choice below before committing the combined cut.", label: "Review conflict"};
  }
  if (repo.currentBranch !== "main" || repo.detachedAt !== null) return {kind: "return", step: 2, title: "You're viewing another cut", text: "Compare its timing with main. Return to main in Versions when you're ready to combine the sample edits. Save any new edits before switching.", label: "Open versions"};
  if (completedSample(repo)) {
    if (tab === "verification" || rail === "issues") return {kind: "findings", step: 6, title: "Decide whether the pause belongs", text: `${lint(timeline).length} structural findings in this cut. Click a finding to locate it. A deliberate pause may be right; the checker cannot decide that for you.`, label: "Open assistant"};
    return {kind: "merged", step: 5, title: "Review the combined cut", text: "The versions have been combined. A conflict-free merge can still contain a pause or missing content. Inspect the actual timeline before delivery.", label: "Inspect findings"};
  }
  if (!repo.branches.alternate || !["main", "alternate"].every(branch => isUnchanged(head(repo, branch).timeline, head(sample.repo, branch).timeline)) || !isUnchanged(timeline, head(repo).timeline)) {
    return {kind: "changed", step: 2, title: "You're editing your own variation", text: "Save or compare your edits in Versions. Reset sample only if you want to return to the original guided scenario.", label: "Open versions"};
  }
  if (diff !== null) {
    if (isUnchanged(diff.base, head(repo, "main").timeline) && isUnchanged(diff.target, head(repo, "alternate").timeline)) return {kind: "compare", step: 3, title: "See what each editor changed", text: "Main delays the middle shot. Alternate brings the ending forward. Combine these decisions to see where they compete for screen time.", label: "Merge versions"};
    return {kind: "comparison", step: 3, title: "You're comparing two snapshots", text: "The highlighted differences come from your selected versions. Compare main with alternate to return to the sample story.", label: "Compare sample edits"};
  }
  if (rail === "versions") return {kind: "versions", step: 2, title: "Two cuts, with the original preserved", text: "Main gives the middle shot more room. Alternate brings the ending forward. Switch between them or open Graph, then compare their changes.", label: "Compare edits"};
  return {kind: "intro", step: 1, title: "Explore different edits without losing your work", text: "Play this short cut, then follow two editing decisions. Compare them, combine them, and catch timing problems before delivery. This sample stays separate from your personal project.", label: "See two versions"};
}
