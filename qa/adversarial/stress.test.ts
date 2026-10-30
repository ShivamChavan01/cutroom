import {expect,it} from "vitest";
import {writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {applyOp,createHistory,emptyTimeline,makeClip,mergeTimelines,putAsset,type Timeline,type Clip} from "../../packages/engine/src/index";
import {findMergeBase,checkout,type Commit,type Repo} from "../../apps/web/src/lib/vcs";
import {deserializeProject,serializeProject} from "../../apps/web/src/lib/persistence/project";
import {buildCommitGraph} from "../../apps/web/src/lib/commitGraph";
const samples:unknown[]=[];
function measure<T>(name:string,fn:()=>T){const times:number[]=[];let output=fn();for(let i=0;i<5;i++){const start=performance.now();output=fn();times.push(performance.now()-start);}return {name,ms:times,output};}
it.each([100,1000,10000])("measure graph/serialization stress at %i commits",count=>{
 const t=emptyTimeline("stress"),commits:Record<string,Commit>={};for(let i=0;i<count;i++)commits[`c${i}`]={id:`c${i}`,parents:i?[`c${i-1}`]:[],timeline:t,at:i,author:"QA",message:`commit ${i}`};
 for(const branchCount of [10,100]){
  const branches:Record<string,string>={main:`c${count-1}`};for(let b=1;b<branchCount;b++)branches[`b${b}`]=`c${Math.max(0,count-1-b)}`;const repo:Repo={commits,branches,currentBranch:"main",detachedAt:null};
  const base=measure("merge-base",()=>findMergeBase(repo,`c${count-1}`,`c${Math.floor(count/2)}`));expect(base.output?.id).toBe(`c${Math.floor(count/2)}`);
  const layout=measure("graph-layout",()=>buildCommitGraph(repo));const co=measure("checkout-pointer-only",()=>checkout(repo,"b1"));const ser=measure("serialize",()=>serializeProject({repo,history:createHistory(t)}));const raw=String(ser.output);
  const de=measure("deserialize-and-validate",()=>deserializeProject(raw));expect(Object.keys(de.output.repo.commits)).toHaveLength(count);
  const memory=process.memoryUsage();samples.push({count,branchCount,bytes:Buffer.byteLength(raw),measurements:[base,co,ser,de,layout].map(({name,ms})=>({name,ms})),memory});
 }
 writeFileSync('.gstack/adversarial-qa/stress.json',JSON.stringify(samples,null,2));
},60000);
it("measure 1000 clips and 5000 metadata records",()=>{
 let t:Timeline=putAsset(emptyTimeline("metadata stress"),{id:"source",kind:"video",duration:10000000});const assets={...t.assets};for(let i=0;i<5000;i++)assets[`a${i}`]={id:`a${i}`,kind:"audio",duration:1000,name:`record ${i}`,tags:["synthetic"]};t={...t,assets};
 const clips:Record<string,Clip>={};for(let i=0;i<1000;i++)clips[`k${i}`]=makeClip({id:`k${i}`,assetId:"source",trackId:"v1",start:i*2000,inPoint:0,duration:1000,volume:1});t={...t,clips};
 const ours=applyOp(t,{type:"setVolume",clipId:"k0",volume:.5}),theirs=applyOp(t,{type:"moveClip",clipId:"k999",start:2000000});const result=measure("1000-clips-5000-assets-merge",()=>mergeTimelines(t,ours,theirs));expect(result.output.clean).toBe(true);expect(Object.keys(result.output.merged.clips)).toHaveLength(1000);
 samples.push({clips:1000,assets:5001,name:result.name,ms:result.ms,memory:process.memoryUsage()});writeFileSync('.gstack/adversarial-qa/stress.json',JSON.stringify(samples,null,2));
});
