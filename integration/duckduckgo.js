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
'use scrict'

import puppeteer from 'puppeteer-core';

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const baseURL = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234'

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('https://duckduckgo.com', {waitUtil: 'networkidle0'});

await page.type('#searchbox_input','lightpanda'),
await Promise.all([
  page.waitForNavigation(),
  page.keyboard.press('Enter'),
]);

await page.waitForNetworkIdle({timeout: 4000});

const links = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('a[data-testid="result-title-a"]')).map(row => {
    return row.getAttribute('href');
  });
});

await page.close();
await context.close();
await browser.disconnect();

let found = {
  homepage: false,
  github: false,
  docs: false,
}
for (const link of links) {
  if (link === 'https://lightpanda.io/') found.homepage = true;
  else if (link === 'https://github.com/lightpanda-io/browser') found.github = true;
  else if (link.startsWith('https://lightpanda.io/docs/')) found.docs = true;
}

if (!found.homepage || !found.github || !found.docs) {
  console.log("Failed to find expected links", found);
  throw new Error("invalid results");
}

