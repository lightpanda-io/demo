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
import assert from 'assert';
import { connectBrowser } from './helpers.js';

// Network.setBlockedURLs applies to every hop of a navigation: a redirect
// onto a blocked URL fails even though the URL we asked for is allowed.
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = await page._client();

const requestUrls = new Map();
let failures = [];
client.on('Network.requestWillBeSent', (event) => {
    requestUrls.set(event.requestId, event.request.url);
});
client.on('Network.loadingFailed', (event) => {
    failures.push({ url: requestUrls.get(event.requestId), reason: event.blockedReason });
});

const expectBlocked = async (target) => {
    failures = [];
    try {
        await page.goto(target, {});
        throw new Error("No block");
    } catch (err) {
        assert.equal("UrlBlocked", err.message.substring(0, 10));
    }
    assert.deepEqual(failures, [{ url: url + '/human.txt', reason: 'inspector' }]);
};

try {
    await client.send('Network.setBlockedURLs', {
        // Anchored on the host: a bare '*/human.txt' would also match the
        // query string of the redirect URL.
        urlPatterns: [{ urlPattern: url.replace(/^https?/, '*') + '/human.txt', block: true }],
    });

    await expectBlocked(url + '/human.txt');
    console.log("OK: direct navigation blocked");

    // The redirect URL is allowed; the hop it lands on is not.
    await expectBlocked(url + '/redirect/to?to=/human.txt');
    console.log("OK: redirect onto a blocked URL blocked");

    // A redirect onto an allowed URL still goes through.
    await page.goto(url + '/redirect/to?to=/bot.txt', {});
    assert.equal(url + '/bot.txt', page.url());
    console.log("OK: redirect onto an allowed URL followed");
} finally {
    // The blocklist is browser-wide; leave nothing behind for the next test.
    await client.send('Network.setBlockedURLs', { urlPatterns: [] });
}

await page.goto(url + '/redirect/to?to=/human.txt', {});
assert.equal(url + '/human.txt', page.url());
console.log("OK: cleared blocklist lets the redirect through");

await page.close();
await context.close();
await browser.disconnect();
