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

// Fetch.enable with selective patterns, driven through a raw CDP session.
// Only requests matching one of the patterns (urlPattern '*' / '?' wildcards,
// optional resourceType) may pause; every other request must proceed without
// any client response. Overrides on the paused requests keep working.

import assert from 'assert';
import { connectBrowser } from './helpers.js'

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

const pageURL = baseURL + '/campfire-commerce/';
const productURL = pageURL + 'json/product.json';
const reviewsURL = pageURL + 'json/reviews.json';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();

async function loadPage() {
    await page.goto(pageURL, { waitUntil: 'load', timeout: 5000 });

    // product.json (XHR) and reviews.json (fetch) both rendered.
    await page.waitForFunction(() => {
        return document.querySelector('#product-description').textContent.length > 0
            && document.querySelectorAll('#product-reviews > div').length > 0;
    }, { timeout: 1000 });

    return page.evaluate(() => {
        const r = document.querySelectorAll('#product-reviews > div > p');
        return {
            desc: document.querySelector('#product-description').textContent,
            reviews: Array.from(r).map((n) => n.textContent),
        };
    });
}

function assertRealReviews(res) {
    assert.equal(res.reviews.length, 3, `expected the served reviews.json: ${JSON.stringify(res.reviews)}`);
    assert.ok(res.reviews[0].startsWith('I recently took the Nomad Backpack'), res.reviews[0]);
}

try {
    const session = await page.createCDPSession();

    let paused = [];
    const errors = [];
    session.on('Fetch.requestPaused', async (event) => {
        paused.push({ url: event.request.url, resourceType: event.resourceType });
        try {
            if (event.request.url === reviewsURL) {
                await session.send('Fetch.fulfillRequest', {
                    requestId: event.requestId,
                    responseCode: 200,
                    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                    body: Buffer.from('["over 9000!"]').toString('base64'),
                });
            } else {
                await session.send('Fetch.continueRequest', { requestId: event.requestId });
            }
        } catch (error) {
            errors.push(error);
        }
    });

    // 1. exact URL, '?' wildcard + matching resourceType, and a wildcard
    // whose resourceType never matches (style.css is a Stylesheet).
    await session.send('Fetch.enable', {
        patterns: [
            { urlPattern: reviewsURL, requestStage: 'Request' },
            { urlPattern: '*/json/produc?.json', resourceType: 'XHR' },
            { urlPattern: '*.css', resourceType: 'Script' },
        ],
    });
    let res = await loadPage();
    assert.equal(errors.length, 0, `interception command failed: ${errors[0]}`);
    assert.deepEqual(
        paused.map((p) => p.url).sort(),
        [productURL, reviewsURL].sort(),
        `unexpected paused set: ${JSON.stringify(paused)}`,
    );
    assert.equal(paused.find((p) => p.url === productURL).resourceType, 'XHR');
    assert.equal(paused.find((p) => p.url === reviewsURL).resourceType, 'Fetch');
    assert.deepEqual(res.reviews, ['over 9000!'], 'fulfillRequest on the matched fetch did not apply');
    assert.ok(res.desc.length > 0 && res.desc != 'xhr: aborted', `continued XHR did not load: ${res.desc}`);

    // 2. resourceType mismatch on an otherwise-matching URL, a URL that
    // matches nothing, and a Response-stage pattern (not paused at the
    // Request stage): no pauses, and the page still loads on its own.
    paused = [];
    await session.send('Fetch.enable', {
        patterns: [
            { urlPattern: '*/json/reviews.json', resourceType: 'XHR' },
            { urlPattern: '*/nope/*' },
            { urlPattern: '*/json/*', requestStage: 'Response' },
        ],
    });
    res = await loadPage();
    assert.equal(paused.length, 0, `nothing should pause: ${JSON.stringify(paused)}`);
    assertRealReviews(res);

    // 3. An explicit empty list pauses nothing (omitting `patterns` would
    // mean every request), and is rejected together with handleAuthRequests.
    await assert.rejects(
        session.send('Fetch.enable', { patterns: [], handleAuthRequests: true }),
        /empty patterns with handleAuth/,
    );
    await session.send('Fetch.enable', { patterns: [] });
    res = await loadPage();
    assert.equal(paused.length, 0, `nothing should pause with empty patterns: ${JSON.stringify(paused)}`);
    assertRealReviews(res);

    // 4. Fetch.disable: nothing pauses either.
    await session.send('Fetch.disable');
    res = await loadPage();
    assert.equal(paused.length, 0, `nothing should pause after disable: ${JSON.stringify(paused)}`);
    assertRealReviews(res);
} finally {
    await page.close();
    await context.close();
    await browser.disconnect();
}
