import {
  emptyTimeline,
  makeClip,
  putAsset,
} from "@cutroom/engine";
import { useEffect } from "react";
import { useEditorStore } from "./store";
import { useVcsStore } from "./vcsStore";
import { Timeline } from "./components/Timeline";

/**
 * Merge-conflict harness: mounts the REAL Timeline into a real pending
 * merge with a real conflict, then reports what rendered. The browser runs
 * it; a CDP driver reads window.__mergeHarness. This is the proof surface
 * the unit tests can't reach — bands, ghosts and the banner literally paint.
 *
 * Scenario, reachable only through real stores:
 * - base (c0): a@0-10s, b@30-32s on v1, both from one asset
 * - branch "other": delete b, add c@3s; commit
 * - main: moveClip b->4s (uncommitted, so the merge takes it along)
 * - merge: c arrives from theirs (ghost at 3s, absent from the working
 *   copy), b is touched on both sides so it must be resolved (deleteModify),
 *   and c [3-5s] collides with b-ours [4-6s] (overlap).
 * Resolving the overlap drops b's deleteModify with it (one resolution
 * path, two conflicts).
 */

const BAND_SELECTOR = 'div[title*="[overlap]"], div[title*="[field]"], div[title*="[delete-vs-edit]"]';

interface Probe {
  readonly conflictKinds: readonly string[];
  readonly bandTitles: readonly string[];
  readonly bandButtons: readonly string[];
  readonly ghostLabels: readonly string[];
  readonly bannerText: string | null;
}

function probe(): Probe {
  const bands = [...document.querySelectorAll<HTMLElement>(BAND_SELECTOR)];
  const ghosts = [
    ...document.querySelectorAll<HTMLElement>('[aria-label~="candidate"]'),
  ];
  const banner = [...document.querySelectorAll("span")].find((span) =>
    span.textContent?.includes("conflict(s) left"),
  );
  return {
    conflictKinds:
      useVcsStore.getState().pending?.result.conflicts.map((c) => c.kind) ?? [],
    bandTitles: bands.map((band) => band.getAttribute("title") ?? ""),
    bandButtons: bands.flatMap((band) =>
      [...band.querySelectorAll("button")].map((b) => b.textContent ?? ""),
    ),
    ghostLabels: ghosts.map((ghost) => ghost.getAttribute("aria-label") ?? ""),
    bannerText: banner?.textContent ?? null,
  };
}

interface HarnessAssertions {
  readonly checks: readonly { readonly name: string; readonly ok: boolean; readonly detail: string }[];
  readonly error: string | null;
}

function runScenario(): void {
  const editor = useEditorStore.getState();
  const vcs = useVcsStore.getState();

  let base = emptyTimeline("merge-harness");
  base = putAsset(base, { id: "asset-a", kind: "video", duration: 60_000 });
  editor.loadTimeline(base);
  editor.dispatch({
    type: "addClip",
    clip: makeClip({ id: "a", trackId: "v1", assetId: "asset-a", start: 0, inPoint: 0, duration: 10_000, volume: 1 }),
  });
  editor.dispatch({
    type: "addClip",
    clip: makeClip({ id: "b", trackId: "v1", assetId: "asset-a", start: 30_000, inPoint: 0, duration: 2_000, volume: 1 }),
  });
  vcs.commitCurrent("seed");
  vcs.createBranch("other");
  vcs.checkoutBranch("other");

  useEditorStore.getState().dispatch({ type: "deleteClip", clipId: "b" });
  useEditorStore.getState().dispatch({
    type: "addClip",
    clip: makeClip({ id: "c", trackId: "v1", assetId: "asset-a", start: 3_000, inPoint: 0, duration: 2_000, volume: 1 }),
  });
  useVcsStore.getState().commitCurrent("theirs drops b, adds c");
  vcs.checkoutBranch("main");
  // Ours moves b inline into a's tail, uncommitted on purpose: the merge
  // takes the working timeline along, matching what the banner advertises.
  useEditorStore.getState().dispatch({ type: "moveClip", clipId: "b", start: 4_000 });
  vcs.beginMerge("other");

  const before = probe();

  const keepC = [...document.querySelectorAll<HTMLElement>(BAND_SELECTOR)]
    .flatMap((band) => [...band.querySelectorAll("button")])
    .find((button) => button.textContent === "Keep c");
  const resolveError =
    keepC === undefined ? "no band button reading Keep c" : null;
  if (keepC !== undefined) keepC.click();

  const afterResolution = probe();
  const pending = useVcsStore.getState().pending;
  const clean = pending !== null && pending.result.clean;
  if (clean) useVcsStore.getState().commitMerge("merge other, keep c");
  const repo = useVcsStore.getState().repo;
  const head = repo?.commits[repo?.branches.main ?? ""];
  const headIsMerge = head !== undefined && head.parents.length === 2;

  const checks: HarnessAssertions["checks"] = [
    {
      name: "pending merge shows two conflicts (deleteModify + overlap)",
      ok:
        before.conflictKinds.length === 2 &&
        before.conflictKinds.includes("deleteModify") &&
        before.conflictKinds.includes("overlap"),
      detail: before.conflictKinds.join(", "),
    },
    {
      name: "a band renders per conflict on the timeline",
      ok:
        before.bandTitles.some((t) => t.includes("[delete-vs-edit]")) &&
        before.bandTitles.some((t) => t.includes("[overlap]")),
      detail: before.bandTitles.join(" | "),
    },
    {
      name: "resolution buttons worded like the merge list render on bands",
      ok: before.bandButtons.includes("Keep c") && before.bandButtons.includes("Keep b"),
      detail: before.bandButtons.join(", "),
    },
    {
      name: "merge-candidate ghost renders for c, absent from the working copy",
      ok: before.ghostLabels.some((label) => label.includes("merge candidate")),
      detail: before.ghostLabels.join(", "),
    },
    {
      name: "merge banner names branch and remaining count",
      ok:
        before.bannerText !== null &&
        before.bannerText.includes("other") &&
        before.bannerText.includes("2 conflict(s) left"),
      detail: before.bannerText ?? "none",
    },
    {
      name: "one band click resolves the overlap and drops deleteModify with it",
      ok: resolveError === null && clean && afterResolution.conflictKinds.length === 0,
      detail: resolveError ?? (clean ? "clean" : afterResolution.conflictKinds.join(", ")),
    },
    {
      name: "bands and ghosts leave the timeline once resolved",
      ok: afterResolution.bandTitles.length === 0 && afterResolution.ghostLabels.length === 0,
      detail: afterResolution.bandTitles.join(" | ") || "none",
    },
    {
      name: "banner disappears when the merge is resolved",
      ok: afterResolution.bannerText === null,
      detail: afterResolution.bannerText ?? "none",
    },
    {
      name: "merge commit lands with two parents",
      ok: headIsMerge,
      detail: `parents=${head?.parents.length ?? 0}`,
    },
  ];

  const result: HarnessAssertions = { checks, error: null };
  (window as { __mergeHarness?: HarnessAssertions }).__mergeHarness = result;
}

export function MergeHarness() {
  useEffect(() => {
    try {
      runScenario();
    } catch (error) {
      const result: HarnessAssertions = {
        checks: [],
        error: error instanceof Error ? error.message : String(error),
      };
      (window as { __mergeHarness?: HarnessAssertions }).__mergeHarness = result;
    }
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <Timeline />
    </div>
  );
}
