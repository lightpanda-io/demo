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
'use scrict'

import puppeteer from 'puppeteer-core';
import assert from 'assert';

// ws address
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// Connect to the browser and open a new blank page
let opts = {};
if (browserAddress.substring(0, 5) == 'ws://') {
    opts.browserWSEndpoint = browserAddress;
} else {
    opts.browserURL = browserAddress;
}
const browser = await puppeteer.connect(opts);

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('http://127.0.0.1:1234', {waitUntil: 'load'});

await Promise.all([
  page.click("a[href='campfire-commerce/']"),
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
