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

// Kit and Ace is a Shopify store. This test loads the home page, searches for
// "t-shirt" through the header search form, clicks the first product result,
// and asserts the product page shows a price and an add-to-cart button.

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

// Load the home page.
await page.goto('https://www.kitandace.com', { timeout: 30000 });

// Type the search term into the header search field and submit it.
await page.waitForSelector('input[name=q]', { timeout: 10000 });
await page.type('input[name=q]', 't-shirt');
await Promise.all([
    page.waitForNavigation({ timeout: 30000 }),
    page.keyboard.press('Enter'),
]);

// Wait for the search results, then click the first product result. We trigger
// the anchor's DOM click() directly (rather than page.click) so the navigation
// fires without depending on layout-based hit testing.
const firstResult = await page.waitForSelector('a[href*="/products/"]', { timeout: 10000 });
await Promise.all([
    page.waitForNavigation({ timeout: 30000 }),
    firstResult.evaluate(el => el.click()),
]);

// Read the price and the add-to-cart button from the product page.
const product = await page.evaluate(() => {
    const priceEl = document.querySelector('.product__price');
    const addButton = document.querySelector('button[name=add]');
    return {
        url: location.pathname,
        price: priceEl ? priceEl.textContent.replace(/\s+/g, ' ').trim() : null,
        addToCart: addButton ? addButton.textContent.replace(/\s+/g, ' ').trim() : null,
    };
});

await page.close();
await context.close();
await browser.disconnect();

console.log(`product ${product.url} — price: ${product.price} — button: ${product.addToCart}`);

// The product page must expose a price (containing a currency amount) and an
// add-to-cart button.
if (!product.price || !/\d/.test(product.price)) {
    console.log("Missing product price", product);
    throw new Error("invalid results");
}
if (!product.addToCart) {
    console.log("Missing add-to-cart button", product);
    throw new Error("invalid results");
}
