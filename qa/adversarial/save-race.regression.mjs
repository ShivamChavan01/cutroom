import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from './playwright.mjs';
const target=process.env.EDITOR_URL??'https://cutroom-editor.vercel.app/';const out='.gstack/adversarial-qa/save-race';await mkdir(out,{recursive:true});const b=await chromium.launch({channel:'chrome',headless:true});
try{
 const c=await b.newContext({viewport:{width:1440,height:900}}),p=await c.newPage();await p.goto(new URL('?demo=1',target).href);await p.locator('[data-save-status="saved"]').waitFor();await p.getByRole('button',{name:'clip opening',exact:true}).click();
 await p.evaluate(()=>{const original=IDBObjectStore.prototype.put;window.qaHoldNext=true;IDBObjectStore.prototype.put=function(...args){const request=original.apply(this,args);if(this.name==='projects'&&window.qaHoldNext){window.qaHoldNext=false;window.qaHeld=true;const hold=()=>{if(!window.qaRelease){const q=this.get('qa-keepalive');q.onsuccess=hold}};hold()}return request}});
 async function editCommit(value,message){const f=p.getByRole('spinbutton',{name:'Clip start seconds',exact:true});await f.fill(value);await f.press('Enter');await p.getByRole('button',{name:'Versions',exact:true}).click();await p.getByRole('textbox',{name:'Commit message',exact:true}).fill(message);await p.getByRole('button',{name:'Commit',exact:true}).click();}
 await editCommit('0.1','First snapshot');await p.waitForFunction(()=>window.qaHeld===true);
 await editCommit('0.2','Second snapshot');await p.evaluate(()=>{window.qaRelease=true});await p.locator('[data-save-status="saved"]').waitFor();
 const raw=await p.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('cutroom',1);q.onsuccess=()=>r(q.result)});try{return await new Promise(r=>{const q=db.transaction('projects').objectStore('projects').get('current.demo-v1');q.onsuccess=()=>r(JSON.parse(q.result))})}finally{db.close()}});
 const messageVisible=await p.getByText('Second snapshot',{exact:true}).isVisible();const result={target,savedStatus:true,latestCommitVisible:messageVisible,storedHead:raw.repo.branches.main,storedMessage:raw.repo.commits[raw.repo.branches.main].message};await p.screenshot({path:`${out}/false-saved.png`});await p.reload();await p.locator('[data-save-status="saved"]').waitFor();await p.getByRole('button',{name:'Versions',exact:true}).click();result.secondCommitAfterReload=await p.getByText('Second snapshot',{exact:true}).count();await writeFile(`${out}/result.json`,JSON.stringify(result,null,2));console.log(result);
 assert.equal(result.secondCommitAfterReload,1,'A saved indicator must guarantee the latest visible commit survives reload');
}finally{await b.close()}
