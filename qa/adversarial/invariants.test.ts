import {beforeEach, expect, it} from "vitest";
import {applyOp, applyOps, clipIsWellFormed, conflictKey, createHistory, current, emptyTimeline, makeClip, putAsset, record, redo, undo, type Op} from "../../packages/engine/src/index";
import {createRepo, commit, checkout, createBranch, head} from "../../apps/web/src/lib/vcs";
import {deserializeProject, serializeProject} from "../../apps/web/src/lib/persistence/project";
import {prepareMerge} from "../../apps/web/src/lib/mergeSession";
import {installDemoProject} from "../../apps/web/src/lib/demo/load";
import {DEMO_VIDEO_ID} from "../../apps/web/src/lib/demo/project";
import {useEditorStore} from "../../apps/web/src/store";
import {useVcsStore} from "../../apps/web/src/vcsStore";
function fixture(){let t=putAsset(emptyTimeline("QA seed"),{id:"video",kind:"video",duration:60000});for(let i=0;i<8;i++)t=applyOp(t,{type:"addClip",clip:makeClip({id:`k${i}`,trackId:"v1",assetId:"video",start:i*2000,inPoint:0,duration:1000,volume:1})});return t;}
function random(seed:number){let n=seed;return()=>{n=(Math.imul(n,1103515245)+12345)>>>0;return n/4294967296;};}
it.each(Array.from({length:1000},(_,i)=>i+10001))("operation replay, snapshots and serialization seed %i",seed=>{
  const rng=random(seed),base=fixture(), initial=JSON.stringify(base);let history=createHistory(base),timeline=base,repo=createRepo(base,"QA");
  const original=JSON.stringify(repo.commits.c0);const snapshots=new Map([["c0",original]]);
  for(let step=0;step<24;step++){
    const id=`k${Math.floor(rng()*8)}`;
    const op:Op=step%4===0?{type:"moveClip",clipId:id,start:Math.floor(rng()*20000)}:step%4===1?{type:"setVolume",clipId:id,volume:Math.floor(rng()*101)/100}:step%4===2?{type:"trimClip",clipId:id,inPoint:Math.floor(rng()*1000),duration:100+Math.floor(rng()*1000)}:{type:"setAssetTags",assetId:"video",tags:[`s${seed}`,`n${step}`]};
    const before=timeline;timeline=applyOp(timeline,op);history=record(history,op,"QA");
    expect(current(undo(history))).toEqual(before);expect(current(redo(undo(history)))).toEqual(timeline);
    expect(Object.values(timeline.clips).every(c=>clipIsWellFormed(c)&&timeline.assets[c.assetId]&&timeline.tracks.some(t=>t.id===c.trackId))).toBe(true);
    if(step%8===7){repo=commit(repo,timeline,`seed ${seed} step ${step}`,"QA");snapshots.set(repo.branches.main!,JSON.stringify(repo.commits[repo.branches.main!]));}
  }
  expect(applyOps(base,history.log.map(e=>e.op))).toEqual(timeline);expect(JSON.stringify(base)).toBe(initial);expect(JSON.stringify(repo.commits.c0)).toBe(original);
  for(const [id,snapshot] of snapshots)expect(JSON.stringify(repo.commits[id])).toBe(snapshot);
  const restored=deserializeProject(serializeProject({repo,history}));expect(current(restored.history)).toEqual(timeline);expect(restored.repo).toEqual(repo);
  const undone=undo(history), replacement:Op={type:"renameProject",name:"new path"},branched=record(undone,replacement,"QA");
  expect(branched.cursor).toBe(branched.log.length);expect(current(redo(branched))).toEqual(current(branched));
  const r2=createBranch(repo,"same");expect(prepareMerge(r2,timeline,"same").kind).toBe("up-to-date");
});

beforeEach(()=>installDemoProject());
const dirty:Record<string,()=>void>={
  move:()=>useEditorStore.getState().dispatch({type:"moveClip",clipId:"opening",start:500}),
  trim:()=>useEditorStore.getState().dispatch({type:"trimClip",clipId:"opening",inPoint:200,duration:1500}),
  volume:()=>useEditorStore.getState().dispatch({type:"setVolume",clipId:"score",volume:.2}),
  tags:()=>useEditorStore.getState().dispatch({type:"setAssetTags",assetId:DEMO_VIDEO_ID,tags:["uncommitted"]}),
  project:()=>useEditorStore.getState().dispatch({type:"renameProject",name:"uncommitted"}),
  transform:()=>useEditorStore.getState().dispatch({type:"setTransform",clipId:"opening",x:-20}),
  delete:()=>useEditorStore.getState().dispatch({type:"deleteClip",clipId:"ending"}),
  split:()=>useEditorStore.getState().dispatch({type:"splitClip",clipId:"opening",at:500}),
  track:()=>useEditorStore.getState().dispatch({type:"addTrack",track:{id:"v2",name:"new layer",kind:"video",muted:false}}),
  importedSource:()=>useEditorStore.getState().addAsset({id:"import-only",kind:"audio",duration:1000}),
  multiple:()=>{dirty.move!();dirty.tags!();dirty.volume!();},
};
it.each(Object.keys(dirty))("committed-only rejects dirty %s through UI store API without mutation",kind=>{
  const repo=JSON.stringify(useVcsStore.getState().repo);dirty[kind]!();const before=useEditorStore.getState(),vcs=useVcsStore.getState();
  expect(()=>vcs.beginMerge("alternate")).toThrow(/uncommitted/);expect(useEditorStore.getState()).toBe(before);expect(useVcsStore.getState()).toBe(vcs);expect(JSON.stringify(vcs.repo)).toBe(repo);
  const restored=deserializeProject(serializeProject({repo:vcs.repo!,history:before.history}));useEditorStore.getState().restoreHistory(restored.history);vcs.restoreRepo(restored.repo);
  expect(()=>vcs.beginMerge("alternate")).toThrow(/uncommitted/);
});
it("undone changes can merge only when tree equals head; redo cannot modify committed snapshots",()=>{
  const vcs=useVcsStore.getState(),before=JSON.stringify(vcs.repo);dirty.move!();useEditorStore.getState().undo();
  expect(vcs.beginMerge("alternate")).toBe("pending");vcs.cancelMerge();useEditorStore.getState().redo();expect(()=>vcs.beginMerge("alternate")).toThrow(/uncommitted/);expect(JSON.stringify(useVcsStore.getState().repo)).toBe(before);
});
it("pending merge cannot commit or resolve after a new working edit; cancellation preserves work",()=>{
  const vcs=useVcsStore.getState(),before=JSON.stringify(vcs.repo);vcs.beginMerge("alternate");const p=useVcsStore.getState().pending!;
  expect(()=>vcs.commitMerge("unresolved")).toThrow(/conflicts/);vcs.resolveConflict(conflictKey(p.result.conflicts[0]!),"a");dirty.tags!();
  expect(()=>vcs.commitMerge("contaminate")).toThrow(/changed/);const working=useEditorStore.getState().timeline;vcs.cancelMerge();expect(useEditorStore.getState().timeline).toBe(working);expect(JSON.stringify(useVcsStore.getState().repo)).toBe(before);
});
it("merge inputs equal committed snapshots, records both parents, and repeated merge is a no-op",()=>{
  const vcs=useVcsStore.getState();vcs.beginMerge("alternate");const p=useVcsStore.getState().pending!;
  expect(p.workingTimeline).toEqual(head(vcs.repo!).timeline);vcs.resolveConflict(conflictKey(p.result.conflicts[0]!),"a");const expected=useVcsStore.getState().pending!.result.merged;
  vcs.commitMerge("reviewed");const repo=useVcsStore.getState().repo!;expect(head(repo).parents).toEqual(["c2","c3"]);expect(head(repo).timeline).toEqual(expected);
  expect(vcs.beginMerge("alternate")).toBe("up-to-date");expect(useVcsStore.getState().repo).toBe(repo);
});
it("empty commits, equivalent trees, delete/restore and three collaborating branches retain ancestry",()=>{
  const base=fixture();let repo=createRepo(base,"QA");repo=createBranch(repo,"one");repo=createBranch(repo,"two");repo=createBranch(repo,"three");repo=commit(repo,base,"empty is API-supported","QA");
  for(const branch of ["one","two","three"]){repo=checkout(repo,branch);const deleted=applyOp(base,{type:"deleteClip",clipId:"k0"});repo=commit(repo,deleted,"deleted","QA");repo=commit(repo,base,"recreated same identity","QA");}
  repo=checkout(repo,"main");for(const branch of ["one","two","three"]){const entry=prepareMerge(repo,head(repo).timeline,branch);expect(entry.kind).toBe("pending");if(entry.kind!=="pending")throw Error("fixture");expect(entry.pending.result.clean).toBe(true);repo=commit(repo,entry.pending.result.merged,"joined","QA",[entry.pending.oursId,entry.pending.theirsId]);}
  expect(head(repo).timeline).toEqual(base);expect(()=>deserializeProject(serializeProject({repo,history:createHistory(base)}))).not.toThrow();
});
