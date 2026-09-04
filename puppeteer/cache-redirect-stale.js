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

// A stale cache entry is revalidated with If-None-Match / If-Modified-Since.
// When the server answers that revalidation with a 3xx instead of a 304, the
// validators belong to the URL they were issued for and must not follow the
// request to the redirect target.
//
// /redirect-stale/script.js answers 200 (ETag + Last-Modified, max-age=1) to
// an unconditional request and 302 → /redirect-stale/headers.js to a
// conditional one. The target is a script that publishes the request headers
// it received on window.echoedHeaders.
//
// Only subresources are cached: a root-frame navigation always skips the
// cache, so the stale entry is the script, not the document.
const url = 'http://127.0.0.1:1236/redirect-stale/index.html';

const browser = await connectBrowser();
await needsCache(browser);

const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = await page._client();

let servedFromCache = false;
client.on('Network.requestServedFromCache', () => {
    servedFromCache = true;
});

const goto = () => page.goto(url, { waitUntil: 'load', timeout: 4000 });
const echoed = () => page.evaluate(() => window.echoedHeaders ?? null);

await client.send('Network.clearBrowserCache');

// 1. Cold miss, stores the entry.
await goto();
if (servedFromCache) throw new Error("Expected cold miss");
if (await echoed() !== null) throw new Error("Expected the first request to be unconditional");
console.log("OK: cold miss stored the entry");

// Wait for max-age=1 to expire.
await new Promise((r) => setTimeout(r, 1500));

// 2. Stale → conditional request → 302. The hop must be unconditional.
servedFromCache = false;
await goto();
if (servedFromCache) throw new Error("Expected the stale entry to be revalidated");
const headers = await echoed();
if (headers === null) throw new Error("Expected the revalidation to be redirected to the echo script");
for (const name of ['If-None-Match', 'If-Modified-Since']) {
    if (name in headers) {
        throw new Error(`${name} followed the request to the redirect target: ${headers[name]}`);
    }
}
console.log("OK: validators did not follow the redirect");

await page.close();
await context.close();
await browser.disconnect();
