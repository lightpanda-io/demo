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
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/cache.html';

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});

const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = await page._client();

let servedFromCache = false;
let fromDiskCache = false;

client.on('Network.requestServedFromCache', () => {
    servedFromCache = true;
});

client.on('Network.responseReceived', (event) => {
    if (event.response.url === url && event.response.fromDiskCache) {
        fromDiskCache = true;
    }
});

await client.send("Network.clearBrowserCache");

await page.setRequestInterception(true);
page.on('request', (request) => {
    request.respond({
        status: 200,
        headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'max-age=3600',
        },
        body: '<html><body>cached body</body></html>',
    });
});

await page.goto(url, { waitUntil: 'networkidle0', timeout: 4000 });
await page.setRequestInterception(false);

if (servedFromCache) {
    throw new Error("Expected first request to not be served from cache");
}
if (fromDiskCache) {
    throw new Error("Expected first request to not be served from disk cache");
}

console.log("OK: first request was a cache miss");

await page.goto(url, { waitUntil: 'networkidle0', timeout: 4000 });
if (!servedFromCache) {
    throw new Error("Expected second request to be served from cache");
}
if (!fromDiskCache) {
    throw new Error("Expected second request to be served from disk cache");
}
console.log("OK: second request was a cache hit");

await page.close();
await context.close();
await browser.disconnect();

