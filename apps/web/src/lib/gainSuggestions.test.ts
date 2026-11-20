import { describe, expect, it } from "vitest";
import { applyOp, createHistory, current, emptyTimeline, makeClip, putAsset, record, undo, type History } from "@cutroom/engine";
import { audioClip, createGainSuggestions, gainFeedback, gainOffer, suppressGainOffer, type GainContext, type GainDecision } from "./gainSuggestions";

function context(): GainContext {
  let timeline = putAsset(emptyTimeline("gain"), { id: "music", kind: "audio", duration: 10_000 });
  for (const id of ["one", "two", "three", "four", "five"]) {
    timeline = applyOp(timeline, { type: "addClip", clip: makeClip({ id, assetId: "music", trackId: "a1", start: 0, inPoint: 0, duration: 1000, volume: 1 }) });
  }
  let history = createHistory(timeline);
  const decisions: GainDecision[] = [];
  for (const [index, id] of ["one", "two", "three"].entries()) {
    history = record(history, { type: "setVolume", clipId: id, volume: 0.3 }, "manual");
    const envelope = history.log.at(-1), clip = current(history).clips[id];
    if (envelope === undefined || clip === undefined) throw new Error("Missing fixture edit");
    decisions.push({ id: index + 1, clip, envelope });
  }
  return { timeline: current(history), history, selectedClipId: "four", isPlaying: false,
    gainSuggestions: { ...createGainSuggestions(), decisions, nextDecision: 3 } };
}

function withHistory(state: GainContext, history: History): GainContext {
  return { ...state, history, timeline: current(history) };
}

describe("relevant gain context", () => {
  it("selects three distinct active manual decisions from the target source and track", () => {
    const offer = gainOffer(context(), []);
    expect(offer).toMatchObject({ clipId: "four", assetId: "music", trackId: "a1", fromVolume: 1, volume: 0.3 });
    expect(offer?.support.map(decision => decision.clip.id)).toEqual(["three", "two", "one"]);
  });

  it("abstains for an empty context and missing or inherited clip IDs", () => {
    const state = context();
    expect(gainOffer({ ...state, gainSuggestions: createGainSuggestions() }, [])).toBeNull();
    for (const selectedClipId of [null, "missing", "constructor", "__proto__"]) {
      expect(gainOffer({ ...state, selectedClipId }, [])).toBeNull();
    }
  });

  it("does not treat missing, video or image assets as audio evidence", () => {
    const state = context();
    for (const kind of ["video", "image"] as const) {
      expect(audioClip({ ...state.timeline, assets: { music: { id: "music", kind, duration: 10_000 } } }, "four")).toBeUndefined();
    }
    expect(audioClip({ ...state.timeline, assets: {} }, "four")).toBeUndefined();
    expect(audioClip({ ...state.timeline, tracks: [] }, "four")).toBeUndefined();
  });

  it("stays quiet while disabled, playing, locked, merging or editing a slider", () => {
    const state = context();
    expect(gainOffer(state, ["a1"])).toBeNull();
    expect(gainOffer({ ...state, isPlaying: true }, [])).toBeNull();
    for (const changes of [{ enabled: false }, { blocked: true }, { gesture: { clip: state.gainSuggestions.decisions[0]!.clip, envelope: null, lockedTracks: [] } }]) {
      expect(gainOffer({ ...state, gainSuggestions: { ...state.gainSuggestions, ...changes } }, [])).toBeNull();
    }
  });

  it("abstains if the target is already matched or belongs to a different cohort", () => {
    const state = context();
    for (const op of [
      { type: "setVolume", clipId: "four", volume: 0.3 },
      { type: "moveClip", clipId: "four", start: 0, trackId: "v1" },
    ] as const) {
      expect(gainOffer(withHistory(state, record(state.history, op, "other")), [])).toBeNull();
    }
  });

  it("retracts evidence on Undo and restores it on Redo without counting it twice", () => {
    const state = context();
    const undone = undo(state.history);
    expect(gainOffer(withHistory(state, undone), [])).toBeNull();
    expect(gainOffer(withHistory(state, { ...undone, cursor: undone.cursor + 1 }), [])?.volume).toBe(0.3);
  });

  it("rejects reused sequence numbers and supporting clips changed or recreated later", () => {
    const state = context();
    const replaced = record(undo(state.history), { type: "setVolume", clipId: "three", volume: 0.3 }, "assisted");
    expect(replaced.log.at(-1)?.seq).toBe(state.history.log.at(-1)?.seq);
    expect(gainOffer(withHistory(state, replaced), [])).toBeNull();
    let changed = record(state.history, { type: "moveClip", clipId: "one", start: 100 }, "other");
    expect(gainOffer(withHistory(state, changed), [])).toBeNull();
    changed = record(state.history, { type: "deleteClip", clipId: "one" }, "other");
    changed = record(changed, { type: "addClip", clip: state.timeline.clips.one! }, "other");
    expect(gainOffer(withHistory(state, changed), [])).toBeNull();
  });

  it("never turns repeated observations of one clip into three decisions", () => {
    const state = context(), decision = state.gainSuggestions.decisions[0]!;
    expect(gainOffer({ ...state, gainSuggestions: { ...state.gainSuggestions, decisions: [decision, decision, decision] } }, [])).toBeNull();
  });

  it("suppresses dismissed patterns and deduplicates bounded local feedback", () => {
    const state = context(), offer = gainOffer(state, []);
    if (offer === null) throw new Error("Expected offer");
    const suppressed = suppressGainOffer(state.gainSuggestions, offer);
    expect(gainOffer({ ...state, gainSuggestions: suppressed }, [])).toBeNull();
    let session = gainFeedback(suppressed, "shown", offer);
    expect(gainFeedback(session, "shown", offer)).toBe(session);
    for (let index = 0; index < 100; index += 1) session = gainFeedback(session, "previewed", offer);
    expect(session.feedback).toHaveLength(64);
    expect(session.feedback.at(-1)?.kind).toBe("previewed");
  });
});
