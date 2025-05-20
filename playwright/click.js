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
import { chromium } from 'playwright';

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

// measure general time.
const gstart = process.hrtime.bigint();
// store all run durations
let metrics = [];

// Connect to an existing browser
console.log("Connection to browser on " + browserAddress);
const browser = await chromium.connectOverCDP({
    endpointURL: browserAddress,
    logger: {
      isEnabled: (name, severity) => true,
      log: (name, severity, message, args) => console.log(`${name} ${message}`)
    }
});

const context = await browser.newContext({
    baseURL: baseURL,
});

const page = await context.newPage();
await page.goto("/");

await page.getByText('Campfire Commerce').click();

if (page.url() !== 'http://127.0.0.1:1234/campfire-commerce/') {
  throw new Error('The new page URL is not as expected.');
}

// ensure product's details is loaded
const price = parseFloat((await page.locator('#product-price').textContent()).substring(1));
if (price !== 244.99) {
  console.log(price);
  throw new Error("invalid product price");
}

// ensure reviews are loaded
const reviews = await page.locator('#product-reviews > div').evaluateAll((rows) => {
  return rows.map(row => ({
    name: row.querySelector('h4').textContent,
    text: row.querySelector('p').textContent,
  }));
});
if (reviews.length !== 3) {
  console.log(reviews);
  throw new Error("invalid reviews length");
}

await page.close();
await context.close();

// Turn off the browser to clean up after ourselves.
await browser.close();
