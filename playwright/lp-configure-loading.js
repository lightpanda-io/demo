// Copyright 2023-2026 Lightpanda (Selecy SAS)
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
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'https://demo-browser.lightpanda.io/campfire-commerce/';

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

// Reuse the browser-level CDP session rather than
// page.context().newCDPSession(page). The latter makes playwright open a
// *second* session on a page target it is already attached to, which
// Lightpanda does not yet support.
const client = await browser.newBrowserCDPSession();
await client.send('LP.configureLoading', {
  subFrame: true,
  worker: true,
  externalStylesheets: true,
});

await page.goto('/campfire-commerce/');

await page.close();
await context.close();

// Turn off the browser to clean up after ourselves.
await browser.close();
