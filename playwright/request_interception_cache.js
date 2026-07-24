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

// Import the Chromium browser into our scraper.
import { chromium } from 'playwright-core';

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

// Connect to an existing browser
console.log("Connection to browser on " + browserAddress);
const browser = await chromium.connectOverCDP({
    endpointURL: browserAddress,
    logger: {
      isEnabled: (name, severity) => true,
      log: (name, severity, message, args) => console.log(`${name} ${message}`)
    }
});

// Playwright disables cache w/ Network.setCacheDisabled command when it
// enables request interception. LP.configureCDP custom command disable the
// Network.setCacheDisabled command to keep cache running.
const client = await browser.newBrowserCDPSession();
await client.send('LP.configureCDP', {
  disableSetCacheDisabled: true,
});

const context = await browser.newContext({
    baseURL: baseURL,
});

const page = await context.newPage();
await page.route('**', async (route, request) => {
  return route.continue();
});
await page.goto('/campfire-commerce/');

// ensure the price is loaded.
await page.waitForFunction(() => {
    const price = document.querySelector('#product-price');
    return price.textContent.length > 0;
}, {}, {timeout: 100}); // timeout 100ms


// ensure the reviews are loaded.
await page.waitForFunction(() => {
    const reviews = document.querySelectorAll('#product-reviews > div');
    return reviews.length > 0;
}, {}, {timeout: 100}); // timeout 100ms

let res = {};

res.price = parseFloat((await page.locator('#product-price').textContent()).substring(1));

await page.close();
await context.close();

// Turn off the browser to clean up after ourselves.
await browser.close();

if (res['price'] != 244.99) {
  console.log(res);
  throw new Error("invalid product price");
}
