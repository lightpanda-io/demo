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

// Puppeteer variant of playwright/cdp_session_redirect.js: drive Fetch
// interception through a raw CDP session (page.createCDPSession attaches an
// auxiliary session via Target.attachToTarget) and navigate through a 302.
// Asserts both hops are paused with fresh requestIds and a stable networkId,
// and that a header override on the initial request does not survive the
// redirect. See the playwright test for the full scenario description.

import assert from 'assert';
import { connectBrowser } from './helpers.js'

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

const initialUrl = baseURL + '/redirect/headers';
const destinationPrefix = baseURL + '/get/headers';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();

try {
    const session = await page.createCDPSession();

    const pauses = [];
    const continuationErrors = [];
    session.on('Fetch.requestPaused', async (event) => {
        const url = event.request.url;
        const params = { requestId: event.requestId };
        if (url === initialUrl || url.startsWith(destinationPrefix)) {
            pauses.push({ url, requestId: event.requestId, networkId: event.networkId, headers: event.request.headers });
            if (url === initialUrl) {
                params.headers = Object.entries({
                    ...event.request.headers,
                    'x-lightpanda-probe': 'initial',
                }).map(([name, value]) => ({ name, value: String(value) }));
            }
        }
        try {
            await session.send('Fetch.continueRequest', params);
        } catch (error) {
            continuationErrors.push(error);
        }
    });

    await session.send('Fetch.enable', {
        patterns: [{ urlPattern: '*', requestStage: 'Request' }],
    });

    const response = await page.goto(initialUrl, { waitUntil: 'load', timeout: 5000 });
    assert.equal(response.status(), 200);
    assert.equal(continuationErrors.length, 0, `continueRequest failed: ${continuationErrors[0]}`);

    assert.equal(pauses.length, 2, `expected 2 paused requests, got: ${pauses.map((p) => p.url)}`);
    assert.equal(pauses[0].url, initialUrl);
    assert.ok(pauses[1].url.startsWith(destinationPrefix), `unexpected second hop: ${pauses[1].url}`);

    assert.notEqual(pauses[0].requestId, pauses[1].requestId, 'redirect pause must get a fresh requestId');
    assert.equal(pauses[0].networkId, pauses[1].networkId, 'networkId must be stable across the redirect');

    const hop2Names = Object.keys(pauses[1].headers).map((h) => h.toLowerCase());
    assert.ok(!hop2Names.includes('x-lightpanda-probe'), 'header override leaked into the redirected request (pause view)');

    const landed = new URL(page.url());
    assert.equal(landed.searchParams.get('probe'), 'initial', 'header override did not reach the initial request');

    const element = await page.$('pre');
    const served = JSON.parse(await page.evaluate((el) => el.textContent, element));
    for (const name of Object.keys(served)) {
        assert.notEqual(name.toLowerCase(), 'x-lightpanda-probe', 'header override leaked into the redirected request (server view)');
    }
} finally {
    await page.close();
    await context.close();
    await browser.disconnect();
}
