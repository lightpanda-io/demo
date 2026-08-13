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

// End-to-end test for request interception through an auxiliary CDP session
// (lightpanda PR #3122 + the redirect re-pause follow-up). Playwright
// implements browserContext.newCDPSession(page) by calling
// Target.attachToTarget through its browser session; the returned session
// must be a NEW session distinct from the one Playwright already uses to
// drive the page, otherwise Playwright's session bookkeeping breaks.
//
// The test enables Fetch through the auxiliary session and navigates to
// /redirect/headers, which 302s to /get/headers. It asserts that:
//   - newCDPSession works and Fetch events arrive on that session,
//   - both the initial request and the redirected request are paused, each
//     with a fresh requestId but a stable networkId (Chromium semantics),
//   - a header override applied via Fetch.continueRequest on the initial
//     request reaches the first server (echoed back as a ?probe= query param
//     on the redirect Location) but is NOT re-applied to the redirected
//     request (Chromium limits overrides to a single network hop),
//   - Playwright's network model sees the redirect chain (lightpanda issue
//     #3174): the hop must arrive as Chromium's redirect form of
//     Network.requestWillBeSent — redirectResponse populated, emitted before
//     the hop's Fetch pause — so request.redirectedFrom()/redirectedTo() are
//     linked and the navigation response carries the post-redirect URL.
//
// Unrelated paused requests (e.g. Chrome's favicon fetch) are continued and
// ignored, so the test also runs against real Chrome for comparison.

import { chromium } from 'playwright-core';
import assert from 'assert';

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

const initialUrl = baseURL + '/redirect/headers';
const destinationPrefix = baseURL + '/get/headers';

const browser = await chromium.connectOverCDP(browserAddress);

const context = await browser.newContext();
const page = await context.newPage();

try {
    // https://github.com/lightpanda-io/browser/pull/3122
    const session = await context.newCDPSession(page);

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

    const response = await page.goto(initialUrl, { timeout: 5000 });
    assert.equal(response.status(), 200);
    assert.equal(continuationErrors.length, 0, `continueRequest failed: ${continuationErrors[0]}`);

    // The navigation response must expose the final (post-redirect) URL, and
    // its request must link back to the initial hop through redirectedFrom().
    assert.ok(response.url().startsWith(destinationPrefix), `response kept the pre-redirect URL: ${response.url()}`);
    const finalRequest = response.request();
    assert.equal(finalRequest.url(), response.url());
    const firstRequest = finalRequest.redirectedFrom();
    assert.ok(firstRequest, 'redirectedFrom() is null: the redirect hop was not reported as a redirect chain');
    assert.equal(firstRequest.url(), initialUrl);
    assert.equal(firstRequest.redirectedTo(), finalRequest);
    assert.equal(firstRequest.redirectedFrom(), null);

    // Both hops must be paused: the initial request and the redirect target.
    assert.equal(pauses.length, 2, `expected 2 paused requests, got: ${pauses.map((p) => p.url)}`);
    assert.equal(pauses[0].url, initialUrl);
    assert.ok(pauses[1].url.startsWith(destinationPrefix), `unexpected second hop: ${pauses[1].url}`);

    // Fresh requestId per pause, stable networkId across the chain.
    assert.notEqual(pauses[0].requestId, pauses[1].requestId, 'redirect pause must get a fresh requestId');
    assert.equal(pauses[0].networkId, pauses[1].networkId, 'networkId must be stable across the redirect');

    // The override must not appear on the redirected request's pause.
    const hop2Names = Object.keys(pauses[1].headers).map((h) => h.toLowerCase());
    assert.ok(!hop2Names.includes('x-lightpanda-probe'), 'header override leaked into the redirected request (pause view)');

    // The redirect endpoint echoes the x-lightpanda-probe header it received
    // into the Location query string: the override reached the first hop.
    const landed = new URL(page.url());
    assert.equal(landed.searchParams.get('probe'), 'initial', 'header override did not reach the initial request');

    // /get/headers serves the headers of the request it received as JSON,
    // rendered in a <pre>. The override must not survive the redirect.
    const headers = JSON.parse(await page.locator('pre').textContent());
    for (const name of Object.keys(headers)) {
        assert.notEqual(name.toLowerCase(), 'x-lightpanda-probe', 'header override leaked into the redirected request (server view)');
    }
} finally {
    await page.close();
    await context.close();
    await browser.close();
}
