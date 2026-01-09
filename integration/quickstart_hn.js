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

// This is a copy of the Quickstart example.
// The test ensures the example is working.

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
  browserWSEndpoint: "ws://127.0.0.1:9222",
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

// Go to hackernews home page.
await page.goto("https://news.ycombinator.com/");

// Find the search box at the bottom of the page and type the term lightpanda
// to search.
await page.type('input[name="q"]','lightpanda');
// Press enter key to run the search.
await page.keyboard.press('Enter');

// Wait until the search results are loaded on the page, with a 5 seconds
// timeout limit.
await page.waitForFunction(() => {
  return document.querySelector('.Story_container') != null;
}, {timeout: 5000});

// Loop over search results to extract data.
const res = await page.evaluate(() => {
return Array.from(document.querySelectorAll('.Story_container')).map(row => {
  return {
    // Extract the title.
    title: row.querySelector('.Story_title span').textContent,
    // Extract the URL.
    url: row.querySelector('.Story_title a').getAttribute('href'),
    // Extract the list of meta data.
    meta: Array.from(row.querySelectorAll('.Story_meta > span:not(.Story_separator, .Story_comment)')).map(row => {
      return row.textContent;
    }),
  }
});
});

// Disconnect Puppeteer.
await page.close();
await context.close();
await browser.disconnect();

let found = false;
for (const result of res) {
  if (result.title === 'Show HN: Lightpanda, an open-source headless browser in Zig') {
    found = true;
    break;
  }
}

if (!found) {
  console.log("Failed to find expected links", res);
  throw new Error("invalid results");
}
