// Copyright 2023-2025 Lightpanda (Selecy SAS)
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

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('https://mastodon.social/explore', {waitUntil: 'networkidle0'});

await page.waitForFunction(() => {
	return document.querySelector('.item-list article') != null;
}, {timeout: 5000});

const articles = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.item-list article')).map(row => {
    return row.textContent;
  });
});

await page.close();
await context.close();
await browser.disconnect();

if (articles.length < 10) {
  console.log("Failed to find expected articles", articles.length);
  throw new Error("invalid results");
}
