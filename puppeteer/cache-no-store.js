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
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1236/no-store/cache.html';
let opts = {};
if (browserAddress.substring(0, 5) == 'ws://') {
    opts.browserWSEndpoint = browserAddress;
} else {
    opts.browserURL = browserAddress;
}
const browser = await puppeteer.connect(opts);
const canClear = await (async () => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const client = await page._client();
    const result = await client.send("Network.canClearBrowserCache");
    await page.close();
    await context.close();
    return result.result;
})();
if (!canClear) {
    console.log("Cache not available, skipping.");
    await browser.disconnect();
    process.exit(0);
}
const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = await page._client();

let servedFromCache = false;
let fromDiskCache = false;

const reset = () => { servedFromCache = false; fromDiskCache = false; };

client.on('Network.requestServedFromCache', () => {
    servedFromCache = true;
});

client.on('Network.responseReceived', (event) => {
    if (event.response.url === url && event.response.fromDiskCache) {
        fromDiskCache = true;
    }
});

await client.send("Network.clearBrowserCache");

await page.goto(url, { waitUntil: 'networkidle0', timeout: 4000 });
if (servedFromCache) throw new Error("no-store: first request should be a miss");
if (fromDiskCache) throw new Error("no-store: first request should not be from disk cache");
console.log("OK: first request was a cache miss");

reset();
await page.goto(url, { waitUntil: 'networkidle0', timeout: 4000 });
if (servedFromCache) throw new Error("no-store: second request should still be a miss");
if (fromDiskCache) throw new Error("no-store: second request should not be from disk cache");
console.log("OK: second request was also a cache miss (no-store respected)");

await page.close();
await context.close();
await browser.disconnect();
