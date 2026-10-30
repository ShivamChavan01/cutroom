import {pathToFileURL} from "node:url";
const modulePath = process.env.PLAYWRIGHT_MODULE;
export const {chromium} = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
