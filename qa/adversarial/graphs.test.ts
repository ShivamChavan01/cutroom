import {expect, it} from "vitest";
import {createHistory, emptyTimeline, type Timeline} from "../../packages/engine/src/index";
import {ancestors, branchHistory, findMergeBase, findMergeBases, type Commit, type Repo} from "../../apps/web/src/lib/vcs";
import {prepareMerge} from "../../apps/web/src/lib/mergeSession";
import {deserializeProject, serializeProject} from "../../apps/web/src/lib/persistence/project";

export function graph(parents: number[][], timeline: Timeline = emptyTimeline("owned QA")): Repo {
  const commits: Record<string, Commit> = {};
  parents.forEach((p, i) => {commits[`c${i}`] = {id: `c${i}`, parents: p.map(n => `c${n}`), timeline, at: 1000-i, author: "synthetic", message: `node ${i}`};});
  return {commits, branches: {main: `c${parents.length-1}`, source: `c${Math.max(0, parents.length-2)}`}, currentBranch: "main", detachedAt: null};
}
function random(seed: number) {let n=seed; return () => {n=(Math.imul(n,1664525)+1013904223)>>>0; return n/4294967296;};}
// Independent transitive closure: no traversal, pruning or helpers from Cutroom.
function oracle(parents: number[][], a: number, b: number): string[] {
  const n=parents.length, reachable=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j||parents[i]!.includes(j)));
  for(let k=0;k<n;k++) for(let i=0;i<n;i++) for(let j=0;j<n;j++) reachable[i]![j]=reachable[i]![j]!||(reachable[i]![k]!&&reachable[k]![j]!);
  const common=Array.from({length:n},(_,i)=>i).filter(i=>reachable[a]![i]&&reachable[b]![i]);
  return common.filter(i=>!common.some(j=>j!==i&&reachable[j]![i])).map(i=>`c${i}`).sort();
}
it.each(Array.from({length:1000},(_,i)=>i+1))("graph oracle seed %i", seed => {
  const rng=random(seed), n=5+Math.floor(rng()*16);
  const parents=Array.from({length:n},(_,i)=>Array.from({length:i},(_,j)=>j).filter(()=>rng()<.2));
  const repo=graph(parents), before=JSON.stringify(repo);
  for(let pair=0;pair<6;pair++) {
    const a=Math.floor(rng()*n),b=Math.floor(rng()*n), expected=oracle(parents,a,b);
    expect(findMergeBases(repo,`c${a}`,`c${b}`).map(c=>c.id),`seed ${seed}, pair ${a}/${b}`).toEqual(expected);
    if(expected.length>1) expect(()=>findMergeBase(repo,`c${a}`,`c${b}`)).toThrow(/multiple merge bases/);
    else expect(findMergeBase(repo,`c${a}`,`c${b}`)?.id??null).toBe(expected[0]??null);
  }
  expect(JSON.stringify(repo)).toBe(before);
});
it.each([
  ["linear",[[],[0],[1],[2]],"c2"],
  ["diamond",[[],[0],[0],[1,2],[3]],"c3"],
  ["three branches",[[],[0],[0],[0],[1,2],[3],[4,5]],"c5"],
  ["disconnected",[[],[],[0],[1]],null],
] as const)("named graph %s",(_name,parents,expected)=>{
  const repo=graph(parents.map(p=>[...p]));
  expect(findMergeBase(repo,repo.branches.main!,repo.branches.source!)?.id??null).toBe(expected);
  if(expected===null){const before=JSON.stringify(repo);expect(()=>prepareMerge(repo,repo.commits[repo.branches.main!]!.timeline,"source")).toThrow(/common ancestor/);expect(JSON.stringify(repo)).toBe(before);}
});
it("explicit criss-cross has two best bases and refuses merge without mutation",()=>{
  const repo=graph([[],[0],[0],[1,2],[2,1]]), before=JSON.stringify(repo);
  expect(findMergeBases(repo,"c3","c4").map(c=>c.id)).toEqual(["c1","c2"]);
  expect(()=>prepareMerge(repo,repo.commits.c4!.timeline,"source")).toThrow(/multiple merge bases/);
  expect(JSON.stringify(repo)).toBe(before);
});
it.each(["cycle","self-cycle","missing-parent","missing-head"])("reject persisted %s",kind=>{
  const repo=graph([[],[0],[1]]), raw=JSON.parse(serializeProject({repo,history:createHistory(emptyTimeline())}));
  if(kind==="cycle") raw.repo.commits.c0.parents=["c2"];
  if(kind==="self-cycle") raw.repo.commits.c1.parents=["c1"];
  if(kind==="missing-parent") raw.repo.commits.c1.parents=["not-a-commit"];
  if(kind==="missing-head") raw.repo.branches.main="absent";
  expect(()=>deserializeProject(JSON.stringify(raw))).toThrow(/cycle|missing/);
});
it("traverses 10000 nested merge commits iteratively",()=>{
  const parents=Array.from({length:10000},(_,i)=>i===0?[]:i===1?[0]:[i-1,0]),repo=graph(parents);
  expect(ancestors(repo,"c9999")).toHaveLength(10000);
  expect(findMergeBase(repo,"c9999","c9500")?.id).toBe("c9500");
  expect(branchHistory(repo)).toHaveLength(10000);
});
