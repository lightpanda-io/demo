// Copyright 2023-2024 Lightpanda (Selecy SAS)
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

import { connectBrowser, assert } from './helpers.js'

// The BiDi counterpart of puppeteer/cdp.js: the same page, the same
// extraction, the same RUNS loop and timing, so the two transports can be
// compared like for like.

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:1234';
const runs = process.env.RUNS ? parseInt(process.env.RUNS) : 100;

const gstart = process.hrtime.bigint();
const metrics = [];

const browser = await connectBrowser();
try {
    for (let run = 0; run < runs; run++) {
        const rstart = process.hrtime.bigint();

        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.goto(baseURL + '/campfire-commerce/');

        // The page fills these in from an XHR and a fetch it starts during
        // parsing, so both land after `load` and have to be waited for.
        await page.waitForFunction(() => {
            return document.querySelector('#product-price').textContent.length > 0;
        }, { timeout: 100 });
        await page.waitForFunction(() => {
            return document.querySelectorAll('#product-reviews > div').length > 0;
        }, { timeout: 100 });

        const res = {};
        res.name = await page.evaluate(() => document.querySelector('#product-name').textContent);
        res.price = parseFloat(await page.evaluate(() => document.querySelector('#product-price').textContent.substring(1)));
        res.description = await page.evaluate(() => document.querySelector('#product-description').textContent);
        res.image = await page.evaluate(() => document.querySelector('#product-image').getAttribute('src'));

        res.related = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#product-related > div')).map(row => ({
                name: row.querySelector('h4').textContent,
                price: parseFloat(row.querySelector('p').textContent.substring(1)),
                image: row.querySelector('img').getAttribute('src'),
            }));
        });

        res.reviews = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#product-reviews > div')).map(row => ({
                name: row.querySelector('h4').textContent,
                text: row.querySelector('p').textContent,
            }));
        });

        assert(res.price === 244.99, `invalid product price: ${JSON.stringify(res)}`);
        assert(res.image === 'images/nomad_000.jpg', `invalid product image: ${JSON.stringify(res)}`);
        assert(res.related.length === 3, `invalid products related length: ${JSON.stringify(res)}`);
        assert(res.reviews.length === 3, `invalid reviews length: ${JSON.stringify(res)}`);

        process.stderr.write('.');
        if (run > 0 && run % 80 == 0) process.stderr.write('\n');

        await page.close();
        await context.close();

        metrics[run] = process.hrtime.bigint() - rstart;
    }
} finally {
    await browser.close();
}

const gduration = process.hrtime.bigint() - gstart;

process.stderr.write('\n');

const avg = metrics.reduce((s, a) => s += a) / BigInt(metrics.length);
const min = metrics.reduce((s, a) => a < s ? a : s);
const max = metrics.reduce((s, a) => a > s ? a : s);

console.log('total runs', runs);
console.log('total duration (ms)', (gduration / 1000000n).toString());
console.log('avg run duration (ms)', (avg / 1000000n).toString());
console.log('min run duration (ms)', (min / 1000000n).toString());
console.log('max run duration (ms)', (max / 1000000n).toString());
