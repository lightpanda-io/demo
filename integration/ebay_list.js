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

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('https://www.ebay.com/b/Nigel-Sylvester-x-Air-Jordan-1-OG-Low-Better-With-Time/15709/bn_7124881158', {});

const result = await page.evaluate(() => {
  // eBay's edge (Akamai Bot Manager) serves a 403 "Error Page | eBay" block
  // page instead of the listing when it flags the traffic as automated.
  // Detect it so we don't report a misleading "invalid results" failure.
  const captcha = document.title === 'Error Page | eBay';

  const items = Array.from(document.querySelectorAll('.brwrvr__item-results h3')).map(row => {
    return row.textContent;
  });

  return { captcha, items };
});

await page.close();
await context.close();
await browser.disconnect();

if (result.captcha) {
  // Not a Lightpanda failure: eBay blocked the request with its bot
  // protection, so no listing was ever rendered. Skip the assertions
  // instead of reporting a false negative.
  console.log("SKIP: eBay served its anti-bot block page, no items to check");
  // integration/main.go detects the special error code
  process.exit(103);
}

const items = result.items;

if (items.length < 20) {
  console.log("Invalid items length", items);
  throw new Error("invalid results");
}
