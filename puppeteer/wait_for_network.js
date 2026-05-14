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
import { connectBrowser } from './helpers.js'

const url = process.env.URL ? process.env.URL : 'https://httpbin.io/xhr/get';
const browser = await connectBrowser();

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto(url);
await page.waitForNetworkIdle();

const xhr_content = await page.evaluate(() => { return document.querySelector('#response').textContent; });
const parsed = JSON.parse(xhr_content);
if (parsed.headers['User-Agent'] != 'Lightpanda/1.0') {
    console.log(xhr_content);
    throw new Error("invalid XHR content");
}

await page.close();
await context.close();
await browser.disconnect();
