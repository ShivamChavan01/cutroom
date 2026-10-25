import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const video = process.env.TEST_VIDEO_A;
const graphic = process.env.TEST_GRAPHIC;
assert.ok(video && graphic, "Set TEST_VIDEO_A and TEST_GRAPHIC to local demo assets");
const target = process.env.EDITOR_URL ?? "http://127.0.0.1:5186";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname));
const out = process.env.QA_OUTPUT_DIR ?? path.resolve(".gstack/editorial-" + Date.now());
await mkdir(out, { recursive: true });
const browser = await chromium.launch({channel: "chrome", headless: true});
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const evidence = [];

async function capture(name) {
  evidence.push({ name, text: await page.locator("body").innerText(), errors: [...errors] });
  await page.screenshot({path: path.join(out,name+".png")});
  await writeFile(path.join(out,"observations.json"),JSON.stringify(evidence,null,2));
  console.log("PASS "+name);
}
async function number(label, value) {
  const input=page.getByRole("spinbutton",{name:label,exact:true});
  await input.fill(String(value));
  await input.press("Enter");
}
async function range(label,value) {
  await page.getByRole("slider",{name:label,exact:true}).evaluate((input,next)=>{
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
    if(!setter)throw new Error("Missing native input setter");
    setter.call(input,String(next));
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
  },value);
}

try {
  await page.goto(target);
  await page.locator("header input[type=file]").first().setInputFiles(video);
  await page.waitForFunction(()=>document.querySelector(".media-poster-image")?.naturalWidth>0);
  const name=path.basename(video);
  await page.getByRole("button",{name:`Select media ${name}`,exact:true}).click();
  const clipLabel=await page.locator(".studio-clip").first().getAttribute("aria-label");
  assert.ok(clipLabel);

  await page.getByRole("textbox",{name:"Search media",exact:true}).fill("no-such-file");
  await page.getByText("No matching media",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Clear search",exact:true}).click();
  await page.getByRole("button",{name:"List view",exact:true}).click();
  assert.equal(await page.locator(".media-grid.is-list").count(),1);
  await page.getByRole("button",{name:"Grid view",exact:true}).click();
  page.once("dialog",(dialog)=>dialog.accept("B-roll, Mountains"));
  await page.getByRole("button",{name:`Tag ${name}`,exact:true}).click();
  await page.getByRole("button",{name:"Mountains",exact:true}).click();
  assert.equal(await page.locator(".media-card-button").count(),1);
  await page.getByRole("button",{name:"All",exact:true}).click();
  await capture("media-search-tags-and-layout");

  await number("Position X",24);
  await number("Position Y",-10);
  await number("Scale X %",75);
  assert.equal(await page.getByRole("spinbutton",{name:"Scale Y %",exact:true}).inputValue(),"75");
  await number("Rotation",15);
  await range("Clip volume",30);
  await page.waitForFunction(()=>[...document.querySelectorAll("video")].some((item)=>getComputedStyle(item).display!=="none"&&Math.abs(item.volume-.3)<.01&&item.style.transform.includes("15deg")));
  await page.getByRole("button",{name:"play",exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll("video")].some((item)=>!item.paused&&item.currentTime>.2));
  await page.getByRole("button",{name:"pause",exact:true}).click();
  await page.getByRole("button",{name:"Track",exact:true}).click();
  await page.getByRole("combobox",{name:"Clip track",exact:true}).selectOption("v2");
  await page.getByRole("button",{name:"Mute track v2",exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-player-track="v2"] video')].filter((item)=>getComputedStyle(item).display!=="none").every((item)=>item.volume===0));
  await page.getByRole("button",{name:"Mute track v2",exact:true}).click();
  await page.getByRole("button",{name:"Hide track v2",exact:true}).click();
  assert.equal(await page.locator('[data-player-track="v2"]').count(),0);
  await page.getByRole("button",{name:"Hide track v2",exact:true}).click();
  await page.getByRole("button",{name:"Lock track v2",exact:true}).click();
  assert.equal(await page.getByRole("spinbutton",{name:"Position X",exact:true}).isDisabled(),true);
  await page.keyboard.press("Delete");
  assert.equal(await page.getByRole("button",{name:clipLabel,exact:true}).count(),1);
  await page.getByRole("button",{name:"Lock track v2",exact:true}).click();
  await capture("transforms-volume-track-controls");

  await number("In point seconds",.25);
  await number("Out point seconds",3.5);
  await range("Timeline zoom",100);
  const clip=page.getByRole("button",{name:clipLabel,exact:true});
  await clip.scrollIntoViewIfNeeded();
  const box=await clip.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+Math.min(40,box.width/2),box.y+box.height/2);
  await page.mouse.down();await page.mouse.move(box.x+Math.min(40,box.width/2)+50,box.y+box.height/2,{steps:5});await page.mouse.up();
  await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Clip start seconds"]')?.value)>.1);
  await page.getByRole("button",{name:"Fit timeline",exact:true}).click();
  await page.getByRole("button",{name:"Trim",exact:true}).click();
  assert.equal(await page.getByRole("spinbutton",{name:"In point seconds",exact:true}).evaluate((item)=>document.activeElement===item),true);
  await capture("trim-drag-and-fit");

  await page.getByRole("tab",{name:"Graphics",exact:true}).click();
  await page.locator("header input[type=file]").first().setInputFiles(graphic);
  await page.getByRole("button",{name:`Select media ${path.basename(graphic)}`,exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll("[data-player-track] img")].some((item)=>item.naturalWidth>0));
  await capture("graphics-import-and-preview");
  await page.getByRole("tab",{name:"Footage",exact:true}).click();
  await page.getByRole("button",{name:`Select media ${name}`,exact:true}).click();
  await page.getByRole("combobox",{name:"Preview zoom",exact:true}).selectOption("0.5");
  assert.match(await page.locator(".player-stage").getAttribute("style"),/scale\(0.5\)/);
  await page.getByRole("combobox",{name:"Preview zoom",exact:true}).selectOption("fit");
  await page.getByRole("button",{name:"Enter fullscreen",exact:true}).click();
  await page.waitForFunction(()=>document.fullscreenElement!==null);
  await page.getByRole("button",{name:"Exit fullscreen",exact:true}).click();
  await page.waitForFunction(()=>document.fullscreenElement===null);

  await page.getByRole("tab",{name:"Project",exact:true}).click();
  await page.getByRole("textbox",{name:"Project name",exact:true}).fill("The quiet north");
  await page.getByRole("button",{name:"Save name",exact:true}).click();
  await page.getByRole("combobox",{name:"Timeline frame rate",exact:true}).selectOption("24");
  page.once("dialog",(dialog)=>dialog.accept("alternate"));
  await page.getByRole("button",{name:"Add version",exact:true}).click();
  await page.getByRole("button",{name:"Versions",exact:true}).click();
  await page.getByPlaceholder("commit message",{exact:true}).fill("Editorial feature check");
  await page.getByRole("button",{name:"Commit",exact:true}).click();
  await page.getByText("saved",{exact:true}).waitFor();
  await page.locator("header").first().getByRole("button",{name:"Export",exact:true}).click();
  const downloadPromise=page.waitForEvent("download");
  await page.getByRole("menuitem").filter({hasText:"Cutroom timeline"}).click();
  const download=await downloadPromise;const file=path.join(out,"editorial-export.cutroom.json");await download.saveAs(file);
  const exported=JSON.parse(await readFile(file,"utf8"));
  assert.equal(exported.timeline.id,"The quiet north");assert.equal(exported.timeline.fps,24);
  assert.ok(Object.values(exported.timeline.clips).some((item)=>item.x===24&&item.rotation===15));
  await capture("versions-project-settings-and-export");

  await page.reload();
  await page.locator("header").first().getByText("The quiet north",{exact:true}).waitFor();
  await page.getByRole("button",{name:clipLabel,exact:true}).click();
  assert.equal(await page.getByRole("spinbutton",{name:"Position X",exact:true}).inputValue(),"24");
  assert.equal(await page.getByRole("spinbutton",{name:"Rotation",exact:true}).inputValue(),"15");
  await page.getByRole("tab",{name:"Project",exact:true}).click();
  assert.equal(await page.getByRole("combobox",{name:"Timeline frame rate",exact:true}).inputValue(),"24");
  await page.setViewportSize({width:1100,height:720});
  await capture("persisted-editorial-project-laptop");
  assert.deepEqual(errors,[]);
} catch(error) {
  await page.screenshot({path:path.join(out,"failure.png")});
  await writeFile(path.join(out,"failure.txt"),String(error.stack)+"\n"+await page.locator("body").innerText());
  throw error;
} finally { await browser.close();console.log("Evidence "+out); }
