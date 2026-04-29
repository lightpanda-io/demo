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

const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});
const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = await page._client();

const canClear = await client.send("Network.canClearBrowserCache");
if (canClear.result) {
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

    const goto = () => page.goto(url, { waitUntil: 'networkidle0', timeout: 4000 });
    const reset = () => { servedFromCache = false; fromDiskCache = false; };

    // Start clean
    await client.send('Network.clearBrowserCache');

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

    // First request — should be a miss
    await goto();
    if (servedFromCache) throw new Error("Expected first request to not be served from cache");
    if (fromDiskCache) throw new Error("Expected first request to not be from disk cache");
    console.log("OK: first request was a cache miss");

    // Second request — should be a hit
    reset();
    await goto();
    if (!servedFromCache) throw new Error("Expected second request to be served from cache");
    if (!fromDiskCache) throw new Error("Expected second request to be from disk cache");
    console.log("OK: second request was a cache hit");

    // Disable cache — request should be a miss even though cache was populated
    reset();
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    await goto();
    if (servedFromCache) throw new Error("Expected request to not be served from cache when disabled");
    if (fromDiskCache) throw new Error("Expected request to not be from disk cache when disabled");
    console.log("OK: request was a cache miss when cache disabled");

    // Clear cache and re-enable — verify nothing gets cached with two requests
    reset();
    await client.send('Network.clearBrowserCache');
    await client.send('Network.setCacheDisabled', { cacheDisabled: false });
    await goto();
    if (servedFromCache) throw new Error("Expected first request after clear to be a miss");
    console.log("OK: first request after clearBrowserCache was a miss");

    reset();
    await goto();
    if (!servedFromCache) throw new Error("Expected second request after clear to be a cache hit");
    if (!fromDiskCache) throw new Error("Expected second request after clear to be from disk cache");
    console.log("OK: second request after clearBrowserCache was a cache hit");
}

await page.close();
await context.close();
await browser.disconnect();
