import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const out=process.env.QA_OUTPUT_DIR ?? path.resolve('.gstack/waveform-qa');
await mkdir(out,{recursive:true});
const target=process.env.EDITOR_URL ?? 'http://127.0.0.1:5186';
assert.ok(['localhost','127.0.0.1'].includes(new URL(target).hostname));
const videoA=process.env.TEST_VIDEO_A;
const videoB=process.env.TEST_VIDEO_B;
const audio=process.env.TEST_AUDIO;
assert.ok(videoA&&videoB&&audio,'Set TEST_VIDEO_A, TEST_VIDEO_B, TEST_AUDIO (2-second silence/tone/silence WAV)');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}});page.setDefaultTimeout(45000);
async function until(predicate){const deadline=Date.now()+45000;while(Date.now()<deadline){if(await page.evaluate(predicate))return;await page.waitForTimeout(100)}throw new Error('Asynchronous condition did not become true')}
try{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(target);
 await page.locator('header input[type=file]').first().setInputFiles([videoA,videoB]);
 await until(async()=>Object.keys((await import('/src/store.ts')).useEditorStore.getState().timeline.clips).length===2);
 await page.getByRole('button',{name:'Fit timeline',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-waveform-state="ready"]').length===2,{},{timeout:15000});
 const sources=await page.locator('.clip-waveform svg').evaluateAll(nodes=>nodes.map(svg=>({inPoint:svg.dataset.sourceIn,duration:svg.dataset.sourceDuration,path:svg.querySelector('path').getAttribute('d')})));
 assert.equal(sources.length,2);
 assert.ok(sources.every(source=>[...source.path.matchAll(/,([0-9.]+)V/g)].some(match=>Number(match[1])<11)));
 await writeFile(path.join(out,'sources.json'),JSON.stringify(sources.map(({path,...source})=>source),null,2));
 await page.screenshot({path:path.join(out,'two-videos.png')});
 await page.evaluate(async()=>{
  const {useEditorStore}=await import('/src/store.ts');const store=useEditorStore.getState();const clip=Object.values(store.timeline.clips)[0];
  store.dispatch({type:'trimClip',clipId:clip.id,inPoint:10000,duration:8000});
  store.dispatch({type:'splitClip',clipId:clip.id,at:3000});
  store.setZoom(80);
 });
 await page.waitForFunction(()=>document.querySelectorAll('svg[data-source-in]').length>=2);
 const offsets=await page.locator('.studio-clip svg').evaluateAll(nodes=>nodes.map(svg=>({inPoint:Number(svg.dataset.sourceIn),duration:Number(svg.dataset.sourceDuration)})));
 assert.ok(offsets.some(offset=>offset.inPoint===10000&&offset.duration===3000));
 assert.ok(offsets.some(offset=>offset.inPoint===13000&&offset.duration===5000));
 await page.screenshot({path:path.join(out,'trimmed-split.png')});
 await page.getByRole('button',{name:'play',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('video')].some(video=>!video.paused&&video.currentTime>10&&video.readyState>=2&&!video.error));
 await page.getByRole('button',{name:'pause',exact:true}).click();
 await page.locator('header input[type=file]').first().setInputFiles(audio);
 await page.getByRole('button',{name:'Fit timeline',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.clip-waveform.is-audio[data-waveform-state="ready"]'));
 const tone=await page.locator('.clip-waveform.is-audio path').getAttribute('d');
 const heights=[...tone.matchAll(/,([0-9.]+)V/g)].map(match=>Number(match[1]));
 assert.ok(heights.length>=3);
 assert.equal(heights[0],12);assert.ok(Math.min(...heights)<3);assert.equal(heights.at(-1),12);
 await page.getByRole('button',{name:'Mute track a1',exact:true}).click();
 assert.equal(await page.locator('.clip-waveform.is-audio').evaluate(element=>getComputedStyle(element).opacity),'0.35');
 await page.getByRole('button',{name:'Mute track a1',exact:true}).click();
 const audioName=path.basename(audio);
 const deadline=Date.now()+45000;
 let persisted=false;
 while(Date.now()<deadline){persisted=await page.evaluate(async(name)=>{const stored=await(await import('/src/lib/persistence/storage.ts')).readProject();return stored.ok&&Boolean(stored.value?.includes(name));},audioName);if(persisted)break;await page.waitForTimeout(100)}
 assert.ok(persisted,'Audio import must reach IndexedDB before reload');

 await page.reload();
 await page.getByRole('button',{name:`Select media ${path.basename(audio)}`,exact:true}).waitFor();
 await page.getByRole('button',{name:'Fit timeline',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.clip-waveform.is-audio[data-waveform-state="ready"]'));
 await page.waitForFunction(()=>document.querySelectorAll('[data-waveform-state="ready"]').length===4);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(out,'reloaded.png')});
 await writeFile(path.join(out,'results.json'),JSON.stringify({sources:sources.map(({path,...source})=>source),tone,offsets,errors,checks:['real AAC in both video files','trim and split source offsets','playback still advances','known silence-tone-silence samples','audio lane waveform','mute styling','reload regeneration']},null,2));
 console.log('PASS real-video and audio waveform browser checks');
}catch(error){await page.screenshot({path:path.join(out,'failure.png')}); console.log(await page.evaluate(()=>({clips:document.querySelectorAll('.studio-clip').length,states:[...document.querySelectorAll('.clip-waveform')].map(el=>({state:el.dataset.waveformState,title:el.title,text:el.textContent})),modules:performance.getEntriesByType('resource').filter(e=>e.name.includes('waveform.ts')).map(e=>e.name)}))); console.error(error);throw error}finally{await browser.close()}
