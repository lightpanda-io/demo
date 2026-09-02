// Copyright 2023-2026 Lightpanda (Selecy SAS)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import puppeteer from 'puppeteer-core';
import { connectBrowser, needsCache } from './helpers.js';

// A followed redirect is a new request: the hop runs its own cache lookup.
// index.html loads its script through a 302. The 302 carries no cache
// headers so it is never cached, but the script it lands on is, and a second
// visit must serve the script from the cache.
//
// Only subresources are cached: a root-frame navigation always skips the
// cache, so the redirect is on the script, not the document.
const base = 'http://127.0.0.1:1236';
const url = `${base}/redirect-cache/index.html`;
const redirect = `${base}/redirect/to?to=/redirect-cache/script.js`;
const target = `${base}/redirect-cache/script.js`;

const browser = await connectBrowser();
await needsCache(browser);

const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = await page._client();

// requestId → the URL of the most recent hop announced for it. The hop's
// requestWillBeSent (with redirectResponse) precedes its cache events.
const requestUrls = new Map();
let servedFromCache = new Set();
let fromDiskCache = new Set();

client.on('Network.requestWillBeSent', (event) => {
    requestUrls.set(event.requestId, event.request.url);
});
client.on('Network.requestServedFromCache', (event) => {
    servedFromCache.add(requestUrls.get(event.requestId));
});
client.on('Network.responseReceived', (event) => {
    if (event.response.fromDiskCache) {
        fromDiskCache.add(event.response.url);
    }
});

const goto = () => page.goto(url, { waitUntil: 'load', timeout: 4000 });
const reset = () => { servedFromCache = new Set(); fromDiskCache = new Set(); };
const loaded = () => page.evaluate(() => window.redirectedScript);

await client.send('Network.clearBrowserCache');

await goto();
if (await loaded() !== true) throw new Error("Expected the redirected script to run");
if (servedFromCache.size !== 0) throw new Error("Expected first visit to be a cache miss");
if (fromDiskCache.size !== 0) throw new Error("Expected first visit to not be from disk cache");
console.log("OK: first visit fetched the redirect target");

reset();
await goto();
if (await loaded() !== true) throw new Error("Expected the redirected script to run");
if (!servedFromCache.has(target)) throw new Error("Expected the redirect target to be served from cache");
if (!fromDiskCache.has(target)) throw new Error("Expected the redirect target to be from disk cache");
if (servedFromCache.has(redirect)) throw new Error("Expected the 302 itself to not be cached");
console.log("OK: second visit served the redirect target from cache");

await page.close();
await context.close();
await browser.disconnect();
