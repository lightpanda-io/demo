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

// Fetch interception at the Response stage through an auxiliary CDP session
// (Playwright's route.fetch() fetches from Node, it never pauses a response
// in the browser). The navigation and both of the page's JSON requests pause
// with their real response; reviews.json is read, rewritten and fulfilled,
// the others are released unchanged. Playwright's network model must see the
// rewritten body, as it does in Chrome. Like Chrome, the Fetch domain reports
// fetch() as XHR.
//
// Then the same rewrite with Request-stage patterns only: continueRequest's
// interceptResponse pauses reviews.json's response on demand.

import { chromium } from 'playwright-core';
import assert from 'assert';

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

const pageURL = baseURL + '/campfire-commerce/';
const productURL = pageURL + 'json/product.json';
const reviewsURL = pageURL + 'json/reviews.json';

const browser = await chromium.connectOverCDP(browserAddress);

const context = await browser.newContext();
const page = await context.newPage();

let session;
try {
    session = await context.newCDPSession(page);

    let pauses = [];
    const errors = [];
    session.on('Fetch.requestPaused', async (event) => {
        const url = event.request.url;
        // A Request-stage pause carries no response.
        const stage = event.responseStatusCode === undefined ? 'Request' : 'Response';
        try {
            if (![pageURL, productURL, reviewsURL].includes(url)) {
                // e.g. Chrome's favicon fetch; continueRequest releases either stage.
                return await session.send('Fetch.continueRequest', { requestId: event.requestId });
            }
            pauses.push({ url, stage, status: event.responseStatusCode, resourceType: event.resourceType });

            if (stage === 'Request') {
                return await session.send('Fetch.continueRequest', {
                    requestId: event.requestId,
                    interceptResponse: url === reviewsURL,
                });
            }
            if (url !== reviewsURL) {
                return await session.send('Fetch.continueResponse', { requestId: event.requestId });
            }
            const { body, base64Encoded } = await session.send('Fetch.getResponseBody', { requestId: event.requestId });
            const reviews = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString() : body);
            reviews.unshift('over 9000!');
            await session.send('Fetch.fulfillRequest', {
                requestId: event.requestId,
                responseCode: event.responseStatusCode,
                responseHeaders: event.responseHeaders,
                body: Buffer.from(JSON.stringify(reviews)).toString('base64'),
            });
        } catch (error) {
            errors.push(error);
        }
    });

    await session.send('Fetch.enable', {
        patterns: [{ urlPattern: '*', requestStage: 'Response' }],
    });

    // The second load needs reviews.json from the network: a 304 revalidation
    // of a cached entry is not offered at the Response stage. Lightpanda
    // disables the cache browser-wide, so finally turns it back on.
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });

    // Loads the page and checks reviews.json was rewritten, for the page and
    // for Playwright's network model.
    async function loadRewritten() {
        const reviewsResponse = page.waitForResponse(reviewsURL, { timeout: 5000 });
        const response = await page.goto(pageURL, { timeout: 5000 });
        assert.equal(response.status(), 200);

        await page.waitForFunction(() => {
            return document.querySelector('#product-description').textContent.length > 0
                && document.querySelectorAll('#product-reviews > div').length > 0;
        }, { timeout: 2000 });
        assert.equal(errors.length, 0, `interception failed: ${errors[0]}`);

        // The page got the rewritten reviews and the untouched product.
        const reviews = await page.locator('#product-reviews > div > p').allTextContents();
        assert.equal(reviews.length, 4, JSON.stringify(reviews));
        assert.equal(reviews[0], 'over 9000!');
        const name = await page.locator('#product-name').textContent();
        assert.equal(name, 'Outdoor Odyssey Nomad Backpack 60 liters');

        // So does Playwright's network model.
        const served = await (await reviewsResponse).json();
        assert.equal(served.length, 4);
        assert.equal(served[0], 'over 9000!');
    }

    await loadRewritten();

    // Each one paused once, at the response stage.
    assert.deepEqual(
        pauses.map((p) => [p.url, p.stage, p.status, p.resourceType]).sort(),
        [
            [pageURL, 'Response', 200, 'Document'],
            [productURL, 'Response', 200, 'XHR'],
            [reviewsURL, 'Response', 200, 'XHR'],
        ].sort(),
    );

    // Request-stage patterns only: each one pauses at the request stage, and
    // only reviews.json, continued with interceptResponse, at the response stage.
    pauses = [];
    await session.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await loadRewritten();
    assert.deepEqual(
        pauses.map((p) => [p.url, p.stage, p.status, p.resourceType]).sort(),
        [
            [pageURL, 'Request', undefined, 'Document'],
            [productURL, 'Request', undefined, 'XHR'],
            [reviewsURL, 'Request', undefined, 'XHR'],
            [reviewsURL, 'Response', 200, 'XHR'],
        ].sort(),
    );

    await session.send('Fetch.disable');
} finally {
    await session?.send('Network.setCacheDisabled', { cacheDisabled: false });
    await page.close();
    await context.close();
    await browser.close();
}
