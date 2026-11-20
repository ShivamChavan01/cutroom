import { beforeEach, describe, expect, it } from "vitest";
import { applyOp, current, emptyTimeline, makeClip, putAsset } from "@cutroom/engine";
import { useEditorStore } from "./store";
import { useUiStore } from "./uiStore";
import { useVcsStore } from "./vcsStore";
import { gainOffer } from "./lib/gainSuggestions";

function seed() {
  useVcsStore.setState({ repo: null, pending: null, diffOverlay: null });
  useUiStore.setState({ lockedTrackIds: [] });
  let timeline = putAsset(emptyTimeline("gain-test"), { id: "music", kind: "audio", duration: 10_000 });
  for (const [index, id] of ["one", "two", "three", "four", "five"].entries()) {
    timeline = applyOp(timeline, { type: "addClip", clip: makeClip({ id, assetId: "music", trackId: "a1", start: index * 1000, inPoint: 0, duration: 1000, volume: 1 }) });
  }
  useEditorStore.getState().loadTimeline(timeline);
  useEditorStore.getState().setGainSuggestionsEnabled(true);
  useVcsStore.getState().ensureRepo();
}

function manual(id: string, volume = 0.3) {
  const store = useEditorStore.getState();
  store.selectClip(id);
  store.beginGainGesture(id);
  store.changeGain(id, volume);
  store.finishGainGesture(id);
}

function offer() {
  return gainOffer(useEditorStore.getState(), useUiStore.getState().lockedTrackIds);
}

function ready() {
  for (const id of ["one", "two", "three"]) manual(id);
  useEditorStore.getState().selectClip("four");
  const candidate = offer();
  if (candidate === null) throw new Error("Expected gain suggestion");
  return candidate;
}

describe("manual context and gain predictions", () => {
  beforeEach(seed);

  it("groups all slider ticks into one completed decision", () => {
    const store = useEditorStore.getState();
    store.selectClip("one");
    store.beginGainGesture("one");
    for (const value of [0.9, 0.8, 0.5, 0.3]) store.changeGain("one", value);
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(0);
    store.finishGainGesture("one");
    store.finishGainGesture("one");
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(1);
    expect(useEditorStore.getState().gainSuggestions.decisions[0]?.clip.volume).toBe(0.3);
    expect(useEditorStore.getState().history.cursor).toBe(4);
    expect(offer()).toBeNull();
  });

  it("does not learn from no-ops, return-to-start, cancellation or failed edits", () => {
    const store = useEditorStore.getState();
    manual("one", 1);
    store.beginGainGesture("one"); store.changeGain("one", 0.4); store.changeGain("one", 1); store.finishGainGesture("one");
    store.beginGainGesture("one"); store.changeGain("one", 0.4); store.cancelGainGesture("one"); store.finishGainGesture("one");
    store.beginGainGesture("one");
    expect(() => store.changeGain("one", Number.NaN)).toThrow();
    store.finishGainGesture("one");
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(0);
    expect(current(useEditorStore.getState().history)).toEqual(useEditorStore.getState().timeline);
  });

  it("does not learn programmatic, assisted, restored or interrupted edits", () => {
    const store = useEditorStore.getState();
    for (const id of ["one", "two", "three"]) store.dispatch({ type: "setVolume", clipId: id, volume: 0.3 });
    store.selectClip("four"); expect(offer()).toBeNull();
    store.applyProposal(useEditorStore.getState().timeline, [{ type: "setVolume", clipId: "four", volume: 0.3 }]);
    store.beginGainGesture("four"); store.changeGain("four", 0.4);
    store.dispatch({ type: "renameProject", name: "interrupted" }); store.finishGainGesture("four");
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(0);
    manual("five");
    const saved = useEditorStore.getState().history;
    store.restoreHistory(saved);
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(0);
  });

  it("counts three distinct clips and retracts undone evidence", () => {
    const candidate = ready(), store = useEditorStore.getState();
    expect(candidate.support).toHaveLength(3);
    store.undo(); expect(offer()).toBeNull();
    store.redo(); expect(offer()?.key).toBe(candidate.key);
    store.undo(); store.dispatch({ type: "setVolume", clipId: "three", volume: 0.3 });
    expect(offer()).toBeNull();
  });

  it("abstains when the latest three distinct decisions disagree", () => {
    ready(); manual("five", 0.5);
    useEditorStore.getState().selectClip("four");
    expect(offer()).toBeNull();
  });

  it("respects the target's own recent manual choice", () => {
    ready(); manual("four", 0.5);
    expect(offer()).toBeNull();
  });

  it("supports a deliberate zero-gain pattern and rejects out-of-range gain", () => {
    for (const id of ["one", "two", "three"]) manual(id, 0);
    const store = useEditorStore.getState(); store.selectClip("four");
    expect(offer()?.volume).toBe(0);
    for (const volume of [-0.1, 1.1, Infinity]) {
      expect(() => store.changeGain("four", volume)).toThrow();
      expect(useEditorStore.getState().timeline.clips.four?.volume).toBe(1);
    }
  });

  it("does not transfer patterns to a different audio source or track", () => {
    ready(); const store = useEditorStore.getState();
    store.addAsset({ id: "dialogue", kind: "audio", duration: 1000 });
    store.dispatch({ type: "addClip", clip: makeClip({ id: "voice", assetId: "dialogue", trackId: "a1", start: 6000, inPoint: 0, duration: 1000, volume: 1 }) });
    store.selectClip("voice"); expect(offer()).toBeNull();
    store.dispatch({ type: "addTrack", track: { id: "a2", kind: "audio", name: "Audio 2", muted: false } });
    store.dispatch({ type: "moveClip", clipId: "four", start: 3000, trackId: "a2" });
    store.selectClip("four"); expect(offer()).toBeNull();
  });

  it("does not learn a gesture interrupted by locking and unlocking a track", () => {
    const store = useEditorStore.getState();
    store.selectClip("one"); store.beginGainGesture("one"); store.changeGain("one", 0.3);
    useUiStore.getState().toggleTrackLocked("a1"); useUiStore.getState().toggleTrackLocked("a1");
    store.finishGainGesture("one");
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(0);
  });

  it("previews without mutation, applies one ordinary operation, and reverses it with one Undo", () => {
    const candidate = ready(), store = useEditorStore.getState(), before = store.timeline;
    const cursor = store.history.cursor;
    store.noteGainSuggestion(candidate.key);
    const preview = store.previewGainSuggestion(candidate.key);
    expect(useEditorStore.getState().timeline).toBe(before);
    expect(preview.proposal.after.clips.four?.volume).toBe(0.3);
    expect(preview.proposal.diff.changed).toBe(1);
    store.applyGainSuggestion(preview);
    const after = useEditorStore.getState();
    expect(after.history.cursor).toBe(cursor + 1);
    expect(after.timeline.clips.four?.volume).toBe(0.3);
    expect(after.gainSuggestions.decisions).toHaveLength(3);
    expect(current(after.history)).toEqual(after.timeline);
    expect(offer()).toBeNull();
    store.undo();
    expect(useEditorStore.getState().timeline).toEqual(before);
    expect(offer()).toBeNull();
    expect(useEditorStore.getState().gainSuggestions.feedback.map(event => event.kind)).toEqual(["shown", "previewed", "applied", "undone"]);
    store.redo(); expect(useEditorStore.getState().timeline).toEqual(after.timeline);
  });

  it("keeps dismissed patterns quiet until new independent manual evidence", () => {
    const candidate = ready(), store = useEditorStore.getState();
    store.dismissGainSuggestion(candidate.key);
    expect(offer()).toBeNull();
    store.selectClip("five"); store.selectClip("four");
    expect(offer()).toBeNull();
    manual("five"); store.selectClip("four");
    expect(offer()?.volume).toBe(0.3);
  });

  it.each(["selection", "lock", "playback", "edit", "commit", "fork", "restore", "disable"])("rejects a preview after a %s transition", transition => {
    const candidate = ready(), store = useEditorStore.getState();
    const preview = store.previewGainSuggestion(candidate.key);
    if (transition === "selection") { store.selectClip("five"); store.selectClip("four"); }
    if (transition === "lock") { useUiStore.getState().toggleTrackLocked("a1"); useUiStore.getState().toggleTrackLocked("a1"); }
    if (transition === "playback") { store.play(); store.pause(); }
    if (transition === "edit") { store.dispatch({ type: "renameProject", name: "changed" }); store.undo(); }
    if (transition === "commit") useVcsStore.getState().commitCurrent("gain edits");
    if (transition === "fork") useVcsStore.getState().forkBranch("alternate");
    if (transition === "restore") store.restoreHistory(store.history);
    if (transition === "disable") store.setGainSuggestionsEnabled(false);
    const before = useEditorStore.getState();
    expect(() => store.applyGainSuggestion(preview)).toThrow("Preview it again");
    expect(useEditorStore.getState()).toBe(before);
  });

  it("rebuilds the supported operation instead of trusting a modified preview payload", () => {
    const candidate = ready(), store = useEditorStore.getState();
    const preview = store.previewGainSuggestion(candidate.key);
    store.applyGainSuggestion({ ...preview, proposal: { ...preview.proposal, ops: [{ type: "deleteClip", clipId: "four" }] } });
    expect(useEditorStore.getState().timeline.clips.four?.volume).toBe(0.3);
  });

  it("preserves evidence across commits but clears it on a fork without replacing history", () => {
    ready(); const store = useEditorStore.getState();
    useVcsStore.getState().commitCurrent("match gains");
    expect(offer()?.volume).toBe(0.3);
    const history = useEditorStore.getState().history, sessionId = store.sessionId;
    useVcsStore.getState().forkBranch("new-cut");
    expect(useEditorStore.getState().history).toBe(history);
    expect(useEditorStore.getState().sessionId).toBe(sessionId);
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(0);
    expect(offer()).toBeNull();
  });

  it("invalidates a restored commit graph even when branch and head IDs match", () => {
    const candidate = ready(), store = useEditorStore.getState(), vcs = useVcsStore.getState();
    const preview = store.previewGainSuggestion(candidate.key), repo = vcs.repo;
    if (repo === null) throw new Error("Missing repository");
    vcs.restoreRepo({ ...repo, commits: { ...repo.commits } });
    expect(offer()).toBeNull();
    expect(() => store.applyGainSuggestion(preview)).toThrow("Preview it again");
  });

  it("blocks previews during a real pending merge, and clears evidence on checkout", () => {
    ready(); const vcs = useVcsStore.getState(), store = useEditorStore.getState();
    vcs.commitCurrent("gains"); vcs.createBranch("alternate");
    store.dispatch({ type: "setVolume", clipId: "five", volume: 0.5 }); vcs.commitCurrent("main");
    vcs.checkoutBranch("alternate");
    expect(store.gainSuggestions.decisions).toHaveLength(3);
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(0);
    store.dispatch({ type: "setVolume", clipId: "five", volume: 0.7 }); vcs.commitCurrent("other");
    vcs.beginMerge("main");
    expect(useVcsStore.getState().pending).not.toBeNull();
    expect(useEditorStore.getState().gainSuggestions.blocked).toBe(true);
    store.selectClip("four"); store.beginGainGesture("four");
    expect(useEditorStore.getState().gainSuggestions.gesture).toBeNull();
    expect(() => store.previewGainSuggestion("old")).toThrow("no longer current");
    vcs.cancelMerge(); expect(useEditorStore.getState().gainSuggestions.blocked).toBe(false);
  });

  it("bounds session evidence and resets it when suggestions are disabled or a workspace is loaded", () => {
    for (let index = 0; index < 50; index += 1) manual("one", index % 2 === 0 ? 0.3 : 0.4);
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(32);
    useEditorStore.getState().setGainSuggestionsEnabled(false);
    manual("two");
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(0);
    useEditorStore.getState().loadTimeline(emptyTimeline("personal"));
    expect(useEditorStore.getState().gainSuggestions.enabled).toBe(false);
    expect(useEditorStore.getState().gainSuggestions.feedback).toHaveLength(0);
  });

  it("keeps manual gain editing usable for video, but learns no audio pattern from it", () => {
    const store = useEditorStore.getState();
    store.addAsset({ id: "video", kind: "video", duration: 1000 });
    store.dispatch({ type: "addClip", clip: makeClip({ id: "video", assetId: "video", trackId: "v1", start: 0, inPoint: 0, duration: 1000, volume: 1 }) });
    manual("video");
    expect(useEditorStore.getState().timeline.clips.video?.volume).toBe(0.3);
    expect(useEditorStore.getState().gainSuggestions.decisions).toHaveLength(0);
  });
});
