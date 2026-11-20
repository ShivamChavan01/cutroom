import { beforeEach, expect, it } from "vitest";
import { emptyTimeline, makeClip, putAsset, applyOp } from "@cutroom/engine";
import { useProductionStore } from "./productionStore";
import { useEditorStore } from "./store";
import { useVcsStore } from "./vcsStore";

const document = { version: 1, brief: "Retain the customer's qualifying words.", styleReferences: [], evidence: [], requirements: [
  { id: "words", label: "Keep the qualification", priority: "required", kind: "preserve", range: { assetId: "source", channel: "audio", inMs: 1000, outMs: 2000 } },
] };
beforeEach(() => {
  useProductionStore.getState().clear();
  useEditorStore.getState().loadTimeline(applyOp(putAsset(emptyTimeline("production"), { id: "source", kind: "audio", duration: 5000 }), {
    type: "addClip", clip: makeClip({ id: "words", assetId: "source", trackId: "a1", start: 0, inPoint: 1000, duration: 1000, volume: 1 }),
  }));
});
it("installs independently parsed context and leaves existing context intact after invalid input", () => {
  const store = useProductionStore.getState(); store.install(document);
  const before = useProductionStore.getState();
  expect(before.document).toEqual(document);
  expect(before.document).not.toBe(document);
  expect(() => store.install({})).toThrow();
  expect(useProductionStore.getState()).toBe(before);
  store.clear(); expect(useProductionStore.getState().document).toBeNull();
  expect(useProductionStore.getState().revision).toBeGreaterThan(before.revision);
  expect(useProductionStore.getState().projectEpoch).toBe(before.projectEpoch + 1);
});
it("enforces the current production requirements at the shared proposal application boundary", () => {
  useProductionStore.getState().install(document);
  const before = useEditorStore.getState();
  expect(() => before.applyProposal(before.timeline, [{ type: "setVolume", clipId: "words", volume: 0 }])).toThrow("qualification");
  expect(useEditorStore.getState()).toBe(before);
  before.applyProposal(before.timeline, [{ type: "setVolume", clipId: "words", volume: 0.5 }]);
  expect(useEditorStore.getState().timeline.clips.words?.volume).toBe(0.5);
});
it("keeps project-wide requirements across a version fork and checkout", () => {
  useProductionStore.getState().install(document);
  useVcsStore.setState({ repo: null, pending: null, diffOverlay: null });
  const vcs = useVcsStore.getState(); vcs.ensureRepo(); vcs.forkBranch("alternate"); vcs.checkoutBranch("main");
  expect(useProductionStore.getState().document).toEqual(document);
});
