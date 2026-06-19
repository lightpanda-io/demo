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

import puppeteer from 'puppeteer-core';

// Product Hunt's weekly leaderboard renders the first batch of products and
// loads the next ones with an Apollo `fetchMore` as the user scrolls down
// (infinite scroll). This test drives the scroll with Puppeteer and checks
// that scrolling loads products beyond the initial render.
//
// Note: the list is virtualized and reports a huge scrollHeight, so we scroll
// *incrementally* (one viewport at a time) rather than jumping straight to the
// bottom — a single jump overshoots all content and never triggers the
// intermediate "load next batch" requests. We also collect the *union* of
// unique product slugs across scroll steps, because the DOM recycles nodes.

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('https://www.producthunt.com/leaderboard/weekly/2025/21', {});

// Wait for the first batch of products to render.
await page.waitForFunction(() => {
    return document.querySelector('a[href^="/products/"]') != null;
}, { timeout: 10000 });

// Collect the unique product slugs currently in the DOM.
const collectSlugs = () => page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href^="/products/"]'))
        .map(a => a.getAttribute('href'));
});

const seen = new Set();
(await collectSlugs()).forEach(s => seen.add(s));
const initial = seen.size;

// Scroll down incrementally, letting each batch load, until the count stops
// growing (or we hit the iteration cap).
let stable = 0;
for (let i = 0; i < 25 && stable < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await new Promise(r => setTimeout(r, 800));

    const before = seen.size;
    (await collectSlugs()).forEach(s => seen.add(s));
    if (seen.size === before) {
        stable++;
    } else {
        stable = 0;
    }
}

await page.close();
await context.close();
await browser.disconnect();

console.log(`collected ${seen.size} unique products (initial render: ${initial})`);

// The first week's leaderboard holds well over 45 products; reaching that many
// proves that scrolling loaded several batches beyond the first one.
if (seen.size < 45) {
    console.log("Not enough products loaded on scroll", seen.size);
    throw new Error("invalid results");
}
