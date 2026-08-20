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

import { connectBrowser, assert, waitFor } from './helpers.js'

const url = process.env.URL ?? 'http://127.0.0.1:1234/campfire-commerce/';
const browser = await connectBrowser();

// Everything runs inside try/finally: an assertion that escapes would leave
// the session open, and a real browser only allows one at a time — the next
// run then fails with "Maximum number of active sessions" rather than the
// error you actually wanted to see.
try {
    const page = await browser.newPage();

    // Unlike the CDP path, goto resolves off browsingContext.load rather than
    // the network events, so it has no HTTPResponse to hand back. The
    // assertions below are all on page content for that reason.
    await page.goto(url);

    const html = await page.content();
    assert(html.startsWith('<!DOCTYPE html>'), 'html does not start with a doctype');
    assert(html.includes('Outdoor Odyssey Nomad Backpack'), 'html is missing the page title');

    const title = await page.evaluate(() => document.title);
    assert(title === 'Outdoor Odyssey Nomad Backpack', `unexpected title: ${title}`);

    // The page fills these in from an XHR and a fetch it starts during
    // parsing, so both land after `load` and have to be waited for.
    const price = await waitFor(
        page,
        () => document.getElementById('product-price').textContent,
        'the product price',
    );
    assert(parseFloat(price.substring(1)) === 244.99, `unexpected price: ${price}`);

    const reviews = await waitFor(
        page,
        () => document.querySelectorAll('#product-reviews > div').length,
        'the product reviews',
    );
    assert(reviews === 3, `unexpected review count: ${reviews}`);

    // Serializing an array of objects covers the RemoteValue shapes a scraper
    // actually depends on.
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#MenuItems a')).map(a => ({
            text: a.textContent,
            href: a.getAttribute('href'),
        }));
    });
    assert(links.length === 5, `unexpected link count: ${links.length}`);
    assert(links[0].text === 'Home', `unexpected first link: ${JSON.stringify(links[0])}`);
    assert(links.every(l => l.href !== undefined), 'a link is missing its href');

    // Every primitive a driver can get back, in one round trip.
    const values = await page.evaluate(() => ({
        string: 'text',
        integer: 42,
        float: 1.5,
        negative: -7,
        boolean: true,
        nothing: null,
        nested: { list: [1, 'two', false] },
    }));
    assert(values.string === 'text', 'string did not survive the round trip');
    assert(values.integer === 42, 'integer did not survive the round trip');
    assert(values.float === 1.5, 'float did not survive the round trip');
    assert(values.negative === -7, 'negative number did not survive the round trip');
    assert(values.boolean === true, 'boolean did not survive the round trip');
    assert(values.nothing === null, 'null did not survive the round trip');
    assert(values.nested.list[1] === 'two', 'nested array did not survive the round trip');

    // Arguments go the other way, as LocalValues.
    const sum = await page.evaluate((a, b) => a + b.n, 1, { n: 2 });
    assert(sum === 3, `unexpected sum: ${sum}`);

    // A throw in the page has to arrive as a rejection, not a hang. Puppeteer
    // rebuilds the error by splitting exceptionDetails.text on its first
    // ": ", so the name has to be in there for the message to survive.
    let threw = false;
    try {
        await page.evaluate(() => { throw new Error('from the page'); });
    } catch (err) {
        threw = true;
        assert(err.name === 'Error', `unexpected error name: ${err.name}`);
        assert(err.message === 'from the page', `unexpected error message: ${err.message}`);
    }
    assert(threw, 'a throwing evaluate did not reject');

    await page.close();
} finally {
    await browser.close();
}
