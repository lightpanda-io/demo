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

// Regression for PR #4210

import assert from "assert";

// Import the Chromium browser into our scraper.
import { chromium } from "playwright-core";

// browserAddress
const browserAddress = process.env.BROWSER_ADDRESS
  ? process.env.BROWSER_ADDRESS
  : "ws://127.0.0.1:9222";

// web server url
const baseURL = process.env.BASE_URL
  ? process.env.BASE_URL
  : "https://demo-browser.lightpanda.io/campfire-commerce/";

// Connect to an existing browser
console.log("Connection to browser on " + browserAddress);
const browser = await chromium.connectOverCDP({
  endpointURL: browserAddress,
  logger: {
    isEnabled: (name, severity) => true,
    log: (name, severity, message, args) => console.log(`${name} ${message}`),
  },
});

const context = await browser.newContext({
  baseURL: baseURL,
});

const page = await context.newPage();

await page.setContent(`
  <div id="ce" contenteditable>start</div>
  <div id="ce-plaintext" contenteditable="plaintext-only">start</div>
  <div id="ce-false" contenteditable="false"><span id="ce-false-child">start</span></div>
  <div id="not-ce">start</div>
`);

assert.strictEqual(await page.isEditable("#ce"), true, "#ce is editable");
await page.fill("#ce", "hello");
assert.strictEqual(
  await page.locator("#ce").textContent(),
  "hello",
  "#ce filled",
);

assert.strictEqual(
  await page.isEditable("#ce-plaintext"),
  true,
  "#ce-plaintext is editable",
);
await page.fill("#ce-plaintext", "plain");
assert.strictEqual(
  await page.locator("#ce-plaintext").textContent(),
  "plain",
  "#ce-plaintext filled",
);

// Neither contenteditable="false" nor a plain element qualifies for an
// editable state at all (not "editable but false") so Chrome and Playwright
// reject these the same way fill() rejected every contenteditable element
// before this fix.
for (const id of ["ce-false", "ce-false-child", "not-ce"]) {
  await assert.rejects(
    () => page.isEditable("#" + id),
    /does not have a role allowing \[aria-readonly\]/,
    `#${id} is not editable`,
  );
}

await page.close();
await context.close();
await browser.close();
