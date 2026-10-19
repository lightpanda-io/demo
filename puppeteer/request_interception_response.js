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

// Fetch interception at the Response stage, driven through a raw CDP session
// (puppeteer's request interception only pauses at the Request stage).
// A paused response can be read (getResponseBody), released unchanged
// (continueResponse / continueRequest), replaced (fulfillRequest) or failed
// (failRequest). Redirects and network failures pause too.

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

// Chrome always base64-encodes a paused body.
async function responseText(session, requestId) {
    const { body, base64Encoded } = await session.send('Fetch.getResponseBody', { requestId });
    return base64Encoded ? Buffer.from(body, 'base64').toString() : body;
}

function header(headers, name) {
    const h = (headers ?? []).find((h) => h.name.toLowerCase() === name);
    return h?.value;
}

async function loadPage(url) {
    await page.goto(url, { waitUntil: 'load', timeout: 5000 });

    // product.json (XHR) and reviews.json (fetch) both settled.
    await page.waitForFunction(() => {
        return document.querySelector('#product-description').textContent.length > 0
            && document.querySelectorAll('#product-reviews > div').length > 0;
    }, { timeout: 1000 });

    return page.evaluate(() => {
        const r = document.querySelectorAll('#product-reviews > div > p');
        return {
            name: document.querySelector('#product-name').textContent,
            desc: document.querySelector('#product-description').textContent,
            reviews: Array.from(r).map((n) => n.textContent),
        };
    });
}

try {
    const session = await page.createCDPSession();

    // Each step installs its own handler; failures are collected, since an
    // exception in an event listener would otherwise go unnoticed. A failed
    // handler still releases its request, so the step fails on its asserts
    // instead of hanging the page until the runner's timeout.
    let onPaused = null;
    let paused = [];
    const errors = [];
    session.on('Fetch.requestPaused', async (event) => {
        paused.push(event);
        try {
            await onPaused(event);
        } catch (error) {
            errors.push(error);
            await session.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {});
        }
    });

    // 1. Read a paused response, then release it unchanged or rewrite it.
    await session.send('Fetch.enable', {
        patterns: [{ urlPattern: '*/json/*', requestStage: 'Response' }],
    });
    onPaused = async (event) => {
        assert.equal(event.responseStatusCode, 200, event.request.url);
        assert.equal(event.responseErrorReason, undefined, event.request.url);
        assert.match(header(event.responseHeaders, 'content-type'), /json/, event.request.url);

        const data = JSON.parse(await responseText(session, event.requestId));

        if (event.request.url === productURL) {
            data.name = 'over 9000!';
            return session.send('Fetch.fulfillRequest', {
                requestId: event.requestId,
                responseCode: event.responseStatusCode,
                responseHeaders: event.responseHeaders,
                body: Buffer.from(JSON.stringify(data)).toString('base64'),
            });
        }
        assert.equal(data.length, 3, 'reviews.json body');
        return session.send('Fetch.continueResponse', { requestId: event.requestId });
    };
    let res = await loadPage(pageURL);
    assert.equal(errors.length, 0, `interception failed: ${errors[0]}`);
    assert.deepEqual(paused.map((p) => p.request.url).sort(), [productURL, reviewsURL].sort());
    assert.equal(paused.find((p) => p.request.url === productURL).resourceType, 'XHR');
    // The Fetch domain reports fetch() as XHR, like Chrome.
    assert.equal(paused.find((p) => p.request.url === reviewsURL).resourceType, 'XHR');
    assert.equal(res.name, 'over 9000!', 'fulfillRequest did not replace the product');
    assert.equal(res.reviews.length, 3, `continueResponse did not deliver reviews: ${JSON.stringify(res.reviews)}`);

    // 2. failRequest fails the XHR (a network error, not an abort);
    // continueRequest releases a response-stage pause unchanged: the request
    // was already sent, so its overrides are ignored.
    paused = [];
    onPaused = async (event) => {
        if (event.request.url === productURL) {
            return session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' });
        }
        return session.send('Fetch.continueRequest', { requestId: event.requestId, url: productURL });
    };
    res = await loadPage(pageURL);
    assert.equal(errors.length, 0, `interception failed: ${errors[0]}`);
    assert.equal(paused.length, 2, `unexpected paused set: ${paused.map((p) => p.request.url)}`);
    assert.equal(res.desc, 'xhr: error');
    assert.equal(res.reviews.length, 3, `continueRequest did not deliver reviews: ${JSON.stringify(res.reviews)}`);

    // 3. A redirect pauses with its status and Location and has no body.
    // continueRequest's url replaces the Location; the response it leads to
    // pauses in turn.
    paused = [];
    await session.send('Fetch.enable', {
        patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }],
    });
    onPaused = async (event) => {
        if (event.responseStatusCode === 302) {
            await assert.rejects(
                session.send('Fetch.getResponseBody', { requestId: event.requestId }),
                /captured after headers received/,
            );
            return session.send('Fetch.continueRequest', { requestId: event.requestId, url: pageURL });
        }
        return session.send('Fetch.continueResponse', { requestId: event.requestId });
    };
    const redirectURL = baseURL + '/redirect/to?to=/nope/';
    res = await loadPage(redirectURL);
    assert.equal(errors.length, 0, `interception failed: ${errors[0]}`);
    assert.deepEqual(
        paused.map((p) => [p.request.url, p.responseStatusCode]),
        [[redirectURL, 302], [pageURL, 200]],
    );
    assert.equal(header(paused[0].responseHeaders, 'location'), '/nope/');
    assert.equal(res.reviews.length, 3);

    // 4. A network failure pauses with responseErrorReason and no response;
    // continuing it reports the original failure. The server drops the
    // connection without replying, which a proxy passes on as is.
    paused = [];
    const closeURL = baseURL + '/net/close';
    await session.send('Fetch.enable', {
        // Exact: with --obey-robots, our robots.txt fetch would pause too.
        patterns: [{ urlPattern: closeURL, requestStage: 'Response' }],
    });
    onPaused = async (event) => {
        await assert.rejects(
            session.send('Fetch.getResponseBody', { requestId: event.requestId }),
            /captured after headers received/,
        );
        return session.send('Fetch.continueResponse', { requestId: event.requestId });
    };
    const failed = await page.evaluate((url) => {
        return fetch(url).then(() => null, (e) => e.name);
    }, closeURL);
    assert.equal(errors.length, 0, `interception failed: ${errors[0]}`);
    assert.equal(failed, 'TypeError');
    assert.equal(paused.length, 1);
    assert.ok(paused[0].responseErrorReason, 'expected a responseErrorReason');
    assert.equal(paused[0].responseStatusCode, undefined);
    assert.equal(paused[0].responseHeaders, undefined);

    // Steps 5 and 6 need responses from the network: a 304 revalidation of a
    // cached entry is not offered at the Response stage. Lightpanda disables
    // the cache browser-wide, so finally turns it back on.
    await page.setCacheEnabled(false);

    // A Request-stage pause carries no response.
    const stage = (event) => (event.responseStatusCode ?? event.responseErrorReason) === undefined ? 'Request' : 'Response';

    // 5. continueRequest's interceptResponse overrides the Response patterns
    // for that request: true pauses product.json's response with no Response
    // pattern for it, false lets reviews.json's through despite one.
    paused = [];
    await session.send('Fetch.enable', {
        patterns: [
            { urlPattern: '*/json/*' },
            { urlPattern: '*/json/reviews.json', requestStage: 'Response' },
        ],
    });
    onPaused = async (event) => {
        if (stage(event) === 'Request') {
            return session.send('Fetch.continueRequest', {
                requestId: event.requestId,
                interceptResponse: event.request.url === productURL,
            });
        }
        assert.equal(event.request.url, productURL);
        assert.equal(event.responseStatusCode, 200);
        const data = JSON.parse(await responseText(session, event.requestId));
        data.name = 'intercepted';
        return session.send('Fetch.fulfillRequest', {
            requestId: event.requestId,
            responseCode: event.responseStatusCode,
            responseHeaders: event.responseHeaders,
            body: Buffer.from(JSON.stringify(data)).toString('base64'),
        });
    };
    res = await loadPage(pageURL);
    assert.equal(errors.length, 0, `interception failed: ${errors[0]}`);
    assert.deepEqual(
        paused.map((p) => [p.request.url, stage(p)]).sort(),
        [[productURL, 'Request'], [productURL, 'Response'], [reviewsURL, 'Request']].sort(),
    );
    assert.equal(res.name, 'intercepted', 'interceptResponse did not pause the product');
    assert.equal(res.reviews.length, 3, `reviews not delivered: ${JSON.stringify(res.reviews)}`);

    // 6. interceptResponse covers a single hop: the redirect response it was
    // given for pauses, and the request it redirects to pauses at the Request
    // stage only, as the patterns say.
    paused = [];
    await session.send('Fetch.enable', {
        patterns: [{ urlPattern: '*', resourceType: 'Document' }],
    });
    const hopURL = baseURL + '/redirect/to?to=/campfire-commerce/';
    onPaused = async (event) => {
        if (stage(event) === 'Request') {
            return session.send('Fetch.continueRequest', {
                requestId: event.requestId,
                interceptResponse: event.request.url === hopURL ? true : undefined,
            });
        }
        return session.send('Fetch.continueResponse', { requestId: event.requestId });
    };
    res = await loadPage(hopURL);
    assert.equal(errors.length, 0, `interception failed: ${errors[0]}`);
    assert.deepEqual(
        paused.map((p) => [p.request.url, stage(p), p.responseStatusCode]),
        [
            [hopURL, 'Request', undefined],
            [hopURL, 'Response', 302],
            [pageURL, 'Request', undefined],
        ],
    );
    assert.equal(res.reviews.length, 3);

    await session.send('Fetch.disable');
} finally {
    await page.setCacheEnabled(true);
    await page.close();
    await context.close();
    await browser.disconnect();
}
