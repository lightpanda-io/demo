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
import { connectBrowser } from './helpers.js'

const url = process.env.URL ? process.env.URL : 'https://demo-browser.lightpanda.io/campfire-commerce/';
const browser = await connectBrowser();

const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = page._client();

// Lightpanda also sends "settled" as a Page.lifecycleEvent.
client.on('Page.lifecycleEvent', e => {
  if (e.name === 'settled') console.log('lifecycle event: settled');
});

// Puppeteer can't wait for "settled" itself: it only knows a fixed list of
// lifecycle names. So return at load, then ask Lightpanda to wait.
await page.goto(url);

const start = Date.now();
await client.send('LP.waitUntil', { until: 'settled', timeout: 10000 });
console.log(`settled after ${Date.now() - start}ms`);

// The product is loaded by JS after the load event.
const name = await page.$eval('#product-name', el => el.textContent.trim());
console.log(`product: ${name}`);

await page.close();
await context.close();
await browser.disconnect();
