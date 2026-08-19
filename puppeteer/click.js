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

import puppeteer from 'puppeteer-core';
import assert from 'assert';
import { connectBrowser } from './helpers.js'

const browser = await connectBrowser();

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('http://127.0.0.1:1234', {waitUntil: 'load'});

await page.evaluate(() => {
  sessionStorage.removeItem('handled');
  document.querySelector("a[href='campfire-commerce/']").addEventListener('click', () => {
    // The listner should fire, but should not stop the navigate
    sessionStorage.setItem('handled', '1');
  });
});

await Promise.all([
  page.click("a[href='campfire-commerce/']"),
  page.waitForNavigation({ waitUntil: 'networkidle0'})
]);

assert.strictEqual(page.url(), 'http://127.0.0.1:1234/campfire-commerce/', 'The new page URL is not as expected.');
assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('handled')), '1', 'The click handler did not run.');

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

await page.goto('http://127.0.0.1:1234', {waitUntil: 'load'});
await Promise.all([
// element.click() must run the default navigation too (#3179).
  page.evaluate(() => document.querySelector("a[href='campfire-commerce/']").click()),
  page.waitForNavigation({ waitUntil: 'load'})
]);
assert.strictEqual(page.url(), 'http://127.0.0.1:1234/campfire-commerce/', 'element.click() did not navigate.');

await page.goto('http://127.0.0.1:1234', {waitUntil: 'load'});
await Promise.all([
  // MouseEvent.click() triggers it too
  page.evaluate(() => document.querySelector("a[href='campfire-commerce/']").dispatchEvent(
    new MouseEvent('click', {bubbles: true, cancelable: true}))),
  page.waitForNavigation({ waitUntil: 'load'})
]);
assert.strictEqual(page.url(), 'http://127.0.0.1:1234/campfire-commerce/', 'dispatchEvent(click) did not navigate.');

await page.goto('http://127.0.0.1:1234', {waitUntil: 'load'});
await page.evaluate(() => {
  window.handlerRan = 0;
  document.querySelector("a[href='campfire-commerce/']").addEventListener('click', (e) => {
    // preventDefault _should_ stop the navigate
    window.handlerRan += 1;
    e.preventDefault();
  });
});
await page.click("a[href='campfire-commerce/']");
await new Promise(resolve => setTimeout(resolve, 500));
assert.strictEqual(page.url(), 'http://127.0.0.1:1234/', 'preventDefault() did not suppress the navigation.');
assert.strictEqual(await page.evaluate(() => window.handlerRan), 1, 'The preventDefault handler did not run.');

await page.close();
await context.close();
await browser.disconnect();
