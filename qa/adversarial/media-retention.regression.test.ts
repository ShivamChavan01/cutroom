import {beforeEach, expect, it, vi} from "vitest";
import {emptyTimeline, makeClip} from "../../packages/engine/src/index";
import {useEditorStore} from "../../apps/web/src/store";
import {useVcsStore} from "../../apps/web/src/vcsStore";
import {deleteSelected} from "../../apps/web/src/lib/actions";
import {deleteMedia} from "../../apps/web/src/lib/media/opfs";
vi.mock("../../apps/web/src/lib/media/opfs",()=>({deleteMedia:vi.fn(async()=>true),isOpfsAvailable:()=>false,readMediaUrl:async()=>null}));
beforeEach(()=>{vi.clearAllMocks();useEditorStore.getState().loadTimeline(emptyTimeline("owned regression"));useVcsStore.setState({repo:null,pending:null,diffOverlay:null});useVcsStore.getState().ensureRepo();});
it("must retain media referenced by an undoable uncommitted import",()=>{
  const e=useEditorStore.getState();e.addAsset({id:"owned-file",kind:"video",duration:1000});e.dispatch({type:"addClip",clip:makeClip({id:"imported",trackId:"v1",assetId:"owned-file",start:0,inPoint:0,duration:1000,volume:1})});e.selectClip("imported");
  deleteSelected();e.undo();expect(useEditorStore.getState().timeline.clips.imported?.assetId).toBe("owned-file");
  expect(deleteMedia,"Undo can still restore this source; deleting its only stored bytes is unsafe").not.toHaveBeenCalled();
});
