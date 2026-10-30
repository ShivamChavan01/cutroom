import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from './playwright.mjs';
const target=process.env.EDITOR_URL??'https://cutroom-editor.vercel.app/';const out='.gstack/adversarial-qa/import-race';await mkdir(out,{recursive:true});const b=await chromium.launch({channel:'chrome',headless:true});
try{
 const c=await b.newContext({viewport:{width:1440,height:900}});
 await c.addInitScript(()=>{const original=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=async function(...args){window.qaWriteHeld=true;await new Promise(resolve=>{window.qaReleaseWrite=resolve});return original.apply(this,args)}});
 const p=await c.newPage();await p.goto(new URL('?demo=1',target).href);await p.getByRole('button',{name:'clip opening',exact:true}).waitFor();
 await p.locator('header input[type="file"]').first().setInputFiles('.gstack/adversarial-qa/media/long.mp4');await p.waitForFunction(()=>window.qaWriteHeld===true);
 await p.getByRole('button',{name:'Versions',exact:true}).click();await p.getByRole('combobox',{name:'Current branch',exact:true}).selectOption('alternate');
 await p.evaluate(()=>window.qaReleaseWrite());await p.getByRole('button',{name:'Media',exact:true}).click();await p.getByRole('button',{name:'Tag long.mp4',exact:true}).waitFor();await p.locator('[data-save-status="saved"]').waitFor();
 const raw=await p.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('cutroom',1);q.onsuccess=()=>r(q.result)});try{return await new Promise(r=>{const q=db.transaction('projects').objectStore('projects').get('current.demo-v1');q.onsuccess=()=>r(JSON.parse(q.result))})}finally{db.close()}});
 const result={initiatedBranch:'main',completionBranch:raw.repo.currentBranch,importedAssets:Object.values(raw.history.base.assets).filter(a=>a.name==='long.mp4').length,log:raw.history.log.map(e=>e.op.type),sourceHead:raw.repo.branches.main,targetHead:raw.repo.branches.alternate};await writeFile(`${out}/result.json`,JSON.stringify(result,null,2));await p.screenshot({path:`${out}/wrong-branch.png`});console.log(result);
 assert.equal(result.importedAssets,0,'An import started on main must not silently insert into the alternate working copy after checkout');
}finally{await b.close()}
