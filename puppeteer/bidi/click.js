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

import assert from 'assert';
import { connectBrowser } from './helpers.js'

// The BiDi counterpart of puppeteer/click.js. page.mouse.click is
// input.performActions (pointerMove, pointerDown, pointerUp) and the
// navigation it triggers is observed through browsingContext events.
//
// page.click(selector) isn't used: puppeteer resolves selectors in its
// utility sandbox (script.addPreloadScript + channels), which the BiDi module
// doesn't implement yet. The element's position comes from page.evaluate.

const browser = await connectBrowser();

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('http://127.0.0.1:1234', {waitUntil: 'load'});

const link = await page.evaluate(() => {
  const r = document.querySelector("a[href='campfire-commerce/']").getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});

await Promise.all([
  page.mouse.click(link.x, link.y),
  page.waitForNavigation({ waitUntil: 'load'})
]);

assert.strictEqual(page.url(), 'http://127.0.0.1:1234/campfire-commerce/', 'The new page URL is not as expected.');

// ensure product's details is loaded
const price = parseFloat(await page.evaluate(() => { return document.querySelector('#product-price').textContent.substring(1); }));
if (price != 244.99) {
  console.log(price);
  throw new Error("invalid product price");
}

// ensure reviews are loaded
const reviews = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('#product-reviews > div')).map(row => {
    return {
        name: row.querySelector('h4').textContent,
        text: row.querySelector('p').textContent,
    };
  });
});
if (reviews.length != 3) {
  console.log(reviews);
  throw new Error("invalid reviews length");
}

await page.close();
await context.close();
await browser.disconnect();
