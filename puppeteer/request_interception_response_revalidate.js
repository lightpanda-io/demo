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
'use strict'

// Fetch interception at the Response stage of a cache revalidation. When the
// stored entry is stale and the content changed, the conditional request gets
// a full 200: a fresh network response, which must pause like any other.

import assert from 'assert';
import { connectBrowser, needsCache } from './helpers.js'

const base = 'http://127.0.0.1:1236';
const url = `${base}/revalidate-etag/index.html`;
const scriptURL = `${base}/revalidate-etag/script.js`;
const bumpUrl = `${base}/revalidate/bump`;

const browser = await connectBrowser();
await needsCache(browser);
const context = await browser.createBrowserContext();
const page = await context.newPage();

try {
    const session = await page.createCDPSession();
    await session.send('Network.clearBrowserCache');

    // 1. Cold miss, no interception: stores the current version (vN).
    await page.goto(url, { waitUntil: 'load', timeout: 4000 });
    const v0 = (await page.content()).match(/version: (\d+)/)?.[1];
    assert.ok(v0, 'could not parse the stored version');

    // 2. Let max-age=1 expire and change the content out-of-band.
    await new Promise((r) => setTimeout(r, 1500));
    await fetch(bumpUrl);

    // 3. The revalidation (If-None-Match) gets a 200 with the new version.
    const paused = [];
    const errors = [];
    session.on('Fetch.requestPaused', async (event) => {
        try {
            // Chrome always base64-encodes a paused body.
            const { body: raw, base64Encoded } = await session.send('Fetch.getResponseBody', { requestId: event.requestId });
            const body = base64Encoded ? Buffer.from(raw, 'base64').toString() : raw;
            paused.push({ url: event.request.url, status: event.responseStatusCode, body });
            await session.send('Fetch.continueResponse', { requestId: event.requestId });
        } catch (error) {
            errors.push(error);
        }
    });
    await session.send('Fetch.enable', {
        patterns: [{ urlPattern: '*/script.js', requestStage: 'Response' }],
    });

    await page.goto(url, { waitUntil: 'load', timeout: 4000 });
    assert.equal(errors.length, 0, `interception failed: ${errors[0]}`);
    assert.equal(paused.length, 1, `expected the revalidated 200 to pause: ${JSON.stringify(paused)}`);
    assert.equal(paused[0].url, scriptURL);
    assert.equal(paused[0].status, 200);

    const v1 = paused[0].body.match(/version: (\d+)/)?.[1];
    assert.ok(v1 && v1 !== v0, `expected a new version in the paused body: ${paused[0].body}`);
    assert.ok((await page.content()).includes(`version: ${v1}`), 'continued response not delivered');

    await session.send('Fetch.disable');
} finally {
    await page.close();
    await context.close();
    await browser.disconnect();
}
