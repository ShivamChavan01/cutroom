import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from './playwright.mjs';
const target=process.env.EDITOR_URL??'https://cutroom-editor.vercel.app/';assert.ok(['cutroom-editor.vercel.app','127.0.0.1'].includes(new URL(target).hostname));
const out='.gstack/adversarial-qa/drop-regression';await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addInitScript(()=>Object.defineProperty(navigator.storage,'getDirectory',{value:async()=>{throw new DOMException('QA injected OPFS write failure','QuotaExceededError')}}));
 const page=await context.newPage();await page.goto(new URL('?demo=1',target).href);await page.getByRole('button',{name:'clip opening',exact:true}).waitFor();
 const data=(await readFile('.gstack/adversarial-qa/media/long.mp4')).toString('base64');
 await page.evaluate(data=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'long.mp4',{type:'video/mp4'}));document.querySelector('.studio-timeline').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));},data);
 await page.getByRole('button',{name:'Tag long.mp4',exact:true}).waitFor();await page.locator('[data-save-status="saved"]').waitFor();
 const body=await page.locator('body').innerText();await page.screenshot({path:`${out}/missing-warning.png`});await writeFile(`${out}/observation.json`,JSON.stringify({target,saved:true,warningVisible:body.includes('QA injected OPFS write failure')},null,2));
 assert.match(body,/QA injected OPFS write failure/,'A drop import must communicate failed durable media storage before presenting a saved project');
}finally{await browser.close()}
