import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from './playwright.mjs';
const target=process.env.EDITOR_URL??'https://cutroom-editor.vercel.app/';
assert.ok(['cutroom-editor.vercel.app','127.0.0.1'].includes(new URL(target).hostname));
const out='.gstack/adversarial-qa/media-browser';await mkdir(out,{recursive:true});
const file=path.resolve('.gstack/adversarial-qa/media/long.mp4'),bytes=await readFile(file),browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
async function saved(p){await p.locator('[data-save-status="saved"]').waitFor();}
async function state(p){await saved(p);return p.evaluate(async()=>{const db=await new Promise((a,b)=>{const r=indexedDB.open('cutroom',1);r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error)});try{return await new Promise((a,b)=>{const r=db.transaction('projects').objectStore('projects').get('current.demo-v1');r.onsuccess=()=>a(JSON.parse(r.result));r.onerror=()=>b(r.error)})}finally{db.close()}});}
async function fresh(fault=false){const c=await browser.newContext({viewport:{width:1440,height:900}});await c.route('**/api/assistant/propose',r=>r.abort());if(fault)await c.addInitScript(()=>{Object.defineProperty(navigator.storage,'getDirectory',{value:async()=>{throw new DOMException('QA synthetic OPFS quota failure','QuotaExceededError')}})});const p=await c.newPage();await p.goto(new URL('?demo=1',target).href);await p.getByRole('button',{name:'clip opening',exact:true}).waitFor();return {c,p};}
async function exists(p,id){return p.evaluate(async id=>{try{const root=await navigator.storage.getDirectory(),d=await root.getDirectoryHandle('media.demo-v1'),f=await d.getFileHandle(id);return (await f.getFile()).size}catch{return null}},id);}
try{
 for(let repeat=1;repeat<=2;repeat++){
  const {c,p}=await fresh();await p.locator('header input[type="file"]').first().setInputFiles(file);await p.getByRole('button',{name:'Tag long.mp4',exact:true}).waitFor();const imported=await state(p);const source=Object.values(imported.history.base.assets).find(a=>a.name==='long.mp4');assert.ok(source);const id=imported.history.log.at(-1).op.clip.id;assert.equal(await exists(p,source.id),bytes.length);
  await p.getByRole('button',{name:`clip ${id}`,exact:true}).click();await p.getByRole('button',{name:`clip ${id}`,exact:true}).focus();await p.keyboard.press('Delete');await p.getByRole('button',{name:'Media',exact:true}).focus();await p.keyboard.press('Control+z');await saved(p);
  // Let the application's asynchronous delete settle before checking durable storage.
  await p.waitForFunction(async id=>{try{const r=await navigator.storage.getDirectory(),d=await r.getDirectoryHandle('media.demo-v1');await d.getFileHandle(id);return false}catch{return true}},source.id);
  const afterUndo=await state(p);assert.equal(afterUndo.history.log[afterUndo.history.cursor-1].op.type,'addClip');
  await p.getByRole('button',{name:'Versions',exact:true}).click();await p.getByRole('textbox',{name:'Commit message',exact:true}).fill('Commit restored import');await p.getByRole('button',{name:'Commit',exact:true}).click();const committed=await state(p);assert.equal(committed.repo.commits[committed.repo.branches.main].timeline.clips[id].assetId,source.id);
  await p.reload();await saved(p);await p.getByRole('button',{name:`clip ${id}`,exact:true}).click();for(let i=0;i<3;i++)await p.getByRole('button',{name:'next cut',exact:true}).click();await p.getByText(/Media not local yet/).waitFor();
  const result={case:'undo-media-deletion',repeat,sourceId:source.id,clipId:id,bytesBefore:bytes.length,bytesAfterUndo:await exists(p,source.id),committedHead:committed.repo.branches.main,warning:await p.locator('body').innerText().then(t=>t.split('\n').filter(x=>/not local|not on disk/.test(x)))};results.push(result);await p.screenshot({path:`${out}/undo-missing-${repeat}.png`});console.log(JSON.stringify(result));await c.close();
 }
 for(const method of ['picker','drop']){
  const {c,p}=await fresh(true);
  if(method==='picker')await p.locator('header input[type="file"]').first().setInputFiles(file);
  else await p.evaluate(({data})=>{const b=Uint8Array.from(atob(data),x=>x.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([b],'long.mp4',{type:'video/mp4'}));const root=document.querySelector('[aria-label="timeline"]')??document.querySelector('.studio-timeline');if(!root)throw Error('No timeline drop target');root.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));},{data:bytes.toString('base64')});
  await p.getByRole('button',{name:'Tag long.mp4',exact:true}).waitFor();await saved(p);const text=await p.locator('body').innerText();const result={case:'storage-failure-reporting',method,warningVisible:text.includes('QA synthetic OPFS quota failure'),savedVisible:await p.locator('[data-save-status="saved"]').isVisible()};results.push(result);await p.screenshot({path:`${out}/quota-${method}.png`});console.log(JSON.stringify(result));await c.close();
 }
 await writeFile(`${out}/results.json`,JSON.stringify({target,results},null,2));
}finally{await browser.close();}
