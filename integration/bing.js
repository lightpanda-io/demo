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

const BROWSER_ADDRESS = process.env.BROWSER_ADDRESS ?? 'ws://127.0.0.1:9222';

const browser = await puppeteer.connect({
    browserWSEndpoint: BROWSER_ADDRESS,
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('https://www.bing.com/', { waitUntil: 'networkidle0' });

const SEARCH_SELECTOR = '#sb_form_q, input[name="q"], input[type="search"]';
await page.waitForSelector('textarea[name="q"]', { timeout: 5000 });
await page.type('textarea[name="q"]', 'Lightpanda');
await page.keyboard.press('Enter');

const submitBtn = await page.$('#sb_form_go, button[type="submit"], input[type="submit"][name="go"]');
await submitBtn.click();
await page.waitForSelector('li.b_algo', { timeout: 15000 });

const results = await page.evaluate(() => {
    // Bing results are in li.b_algo elements
    const items = Array.from(document.querySelectorAll('li.b_algo'));
    return items.map(el => {
        const titleEl = el.querySelector('h2 a') || el.querySelector('a');
        const snippetEl = el.querySelector('.b_caption p') || el.querySelector('p');
        return {
            title: titleEl?.textContent?.trim() ?? '(no title)',
            href: titleEl?.href ?? '(no href)',
            snippet: snippetEl?.textContent?.trim()?.slice(0, 120) ?? '(no snippet)',
        };
    });
});

await page.close();
await context.close();
await browser.disconnect();

if (results.length < 10) {
  console.log("Failed to find search results", results.length);
  throw new Error("invalid search results");
}

let homepage = false;
for (const res of results) {
  if (res.title === 'Lightpanda | The headless browser') homepage = true;
}

if (!homepage) {
  console.log("Failed to find expected links", homepage);
  throw new Error("invalid results");
}
