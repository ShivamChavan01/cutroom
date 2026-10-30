import { describe, expect, it } from "vitest";
import { describeOp } from "./describeOp";

describe("describeOp", () => {
  it("narrates each op type in seconds, not ms", () => {
    expect(
      describeOp({
        type: "addClip",
        clip: {
          id: "a", trackId: "v1", assetId: "x", start: 2_000,
          inPoint: 0, duration: 3_000, volume: 1, outPoint: 3_000,
        },
      }),
    ).toBe("added a on v1 at 2.0s");

    expect(describeOp({ type: "detachAudio", clipId: "a", trackId: "a1" })).toBe("detached a audio to a1");
    expect(describeOp({ type: "deleteClip", clipId: "a" })).toBe("deleted a");
    expect(describeOp({ type: "splitClip", clipId: "a", at: 1_500 })).toBe(
      "split a at +1.5s",
    );
    expect(
      describeOp({ type: "trimClip", clipId: "a", inPoint: 500, duration: 2_000 }),
    ).toBe("trimmed a (in 0.5s, dur 2.0s)");
    expect(
      describeOp({ type: "moveClip", clipId: "a", start: 9_000 }),
    ).toBe("moved a to 9.0s");
    expect(
      describeOp({ type: "setVolume", clipId: "a", volume: 0.5 }),
    ).toBe("set a volume to 0.5");
  });
  it("narrates visual edits, tracks and project settings", () => {
    expect(describeOp({type:"setTransform",clipId:"a",x:20})).toBe("transformed a");
    expect(describeOp({type:"addTrack",track:{id:"v2",name:"Video 2",kind:"video",muted:false}})).toBe("added track Video 2");
    expect(describeOp({type:"setFrameRate",fps:24})).toBe("set timeline to 24 fps");
    expect(describeOp({type:"renameProject",name:"North"})).toBe("renamed project to North");
    expect(describeOp({type:"setAssetTags",assetId:"source",tags:["interview"]})).toBe("updated tags for source");
  });
});
