import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline, makeClip, putAsset, diffTimelines } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";
import { useVcsStore } from "../vcsStore";
import { createRepo, currentCommit } from "../lib/vcs";
import { ProjectSettings } from "./ProjectSettings";
import { VersionRail } from "./VersionRail";
import { Inspector } from "./Inspector";

vi.mock("../store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store")>();
  return { ...actual, useEditorStore: Object.assign(<T,>(selector: (state: ReturnType<typeof actual.useEditorStore.getState>) => T) => selector(actual.useEditorStore.getState()), { getState: actual.useEditorStore.getState }), useSelection: () => actual.useEditorStore.getState().selectedClipId };
});
vi.mock("../vcsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vcsStore")>();
  return { ...actual, useVcsStore: Object.assign(<T,>(selector: (state: ReturnType<typeof actual.useVcsStore.getState>) => T) => selector(actual.useVcsStore.getState()), {getState: actual.useVcsStore.getState, setState: actual.useVcsStore.setState}) };
});
vi.mock("../uiStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../uiStore")>();
  return { ...actual, useUiStore: Object.assign(<T,>(selector: (state: ReturnType<typeof actual.useUiStore.getState>) => T) => selector(actual.useUiStore.getState()), {getState: actual.useUiStore.getState, setState: actual.useUiStore.setState}) };
});

describe("editorial editing features", () => {
  beforeEach(() => {
    useUiStore.setState({ hiddenTrackIds: [], mutedTrackIds: [], lockedTrackIds: [], inspectorTab: "clip" });
    useEditorStore.getState().loadTimeline(putAsset(emptyTimeline("Editorial project"), {id:"asset-a", kind:"video", duration:10_000,name:"scene.mp4"}));
    useEditorStore.getState().dispatch({type:"addClip", clip:makeClip({id:"clip-a",trackId:"v1",assetId:"asset-a",start:0,inPoint:0,duration:4_000,volume:1})});
    useEditorStore.getState().selectClip("clip-a");
    useVcsStore.setState({repo:createRepo(useEditorStore.getState().timeline,"tester"),pending:null,diffOverlay:null});
  });

  it("blocks changes to locked tracks without adding history", () => {
    const before=useEditorStore.getState().history.log.length;
    useUiStore.getState().toggleTrackLocked("v1");
    expect(() => useEditorStore.getState().dispatch({type:"setTransform",clipId:"clip-a",x:40})).toThrow("locked");
    expect(useEditorStore.getState().history.log).toHaveLength(before);
    useUiStore.getState().toggleTrackLocked("v1");
    useEditorStore.getState().dispatch({type:"setTransform",clipId:"clip-a",x:40});
    expect(useEditorStore.getState().timeline.clips["clip-a"]?.x).toBe(40);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().timeline.clips["clip-a"]?.x ?? 0).toBe(0);
  });

  it("blocks moving a clip into a locked destination", () => {
    useEditorStore.getState().dispatch({type:"addTrack",track:{id:"v2",name:"Video 2",kind:"video",muted:false}});
    useUiStore.getState().toggleTrackLocked("v2");
    expect(() => useEditorStore.getState().dispatch({type:"moveClip",clipId:"clip-a",start:0,trackId:"v2"})).toThrow("locked");
    expect(useEditorStore.getState().timeline.clips["clip-a"]?.trackId).toBe("v1");
  });

  it("forks a version without discarding working edits", () => {
    useEditorStore.getState().dispatch({type:"setTransform",clipId:"clip-a",rotation:15});
    useVcsStore.getState().forkBranch("alternate");
    const repo=useVcsStore.getState().repo;
    if(repo===null)throw new Error("Missing repository");
    expect(repo.currentBranch).toBe("alternate");
    expect(useEditorStore.getState().timeline.clips["clip-a"]?.rotation).toBe(15);
    expect(currentCommit(repo).timeline.clips["clip-a"]?.rotation ?? 0).toBe(0);
    expect(renderToStaticMarkup(<VersionRail />)).toContain("Switch to version alternate");
  });

  it("tracks project settings changes as uncommitted metadata", () => {
    const before=useEditorStore.getState().timeline;
    useEditorStore.getState().dispatch({type:"renameProject",name:"North cut"});
    useEditorStore.getState().dispatch({type:"setFrameRate",fps:24});
    const after=useEditorStore.getState().timeline;
    expect(diffTimelines(before,after).metadataChanges).toEqual(expect.arrayContaining(["id","fps"]));
    const html=renderToStaticMarkup(<ProjectSettings />);
    expect(html).toContain('value="North cut"');
    expect(html).toContain('<option value="24" selected="">24 fps</option>');
  });

  it("renders actual transform, trim, volume and track controls", () => {
    useEditorStore.getState().dispatch({type:"setTransform",clipId:"clip-a",x:25,scaleX:.75,scaleY:.75,rotation:15});
    const html=renderToStaticMarkup(<Inspector />);
    for(const label of ["Position X","Position Y","Scale X %","Scale Y %","Rotation","In point seconds","Out point seconds","Clip volume","Clip track"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('value="25"');
    expect(html).toContain('value="75"');
    expect(html).toContain("scene.mp4");
  });
});
