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

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = page._client();

// Print the page console logs.
page.on('console', msg => {
  console.log(`[console.${msg.type()}] ${msg.text()}`);
});

await page.goto(url);
await client.send('LP.waitUntil', { until: 'settled' });

const cmd = await client.send('LP.getPageStatus', {});
console.log(cmd);

await page.close();
await context.close();
await browser.disconnect();


