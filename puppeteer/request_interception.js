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

// ws address
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';


(async () => {
  // Connect to the browser and open a new blank page
  let opts = {};
  if (browserAddress.substring(0, 5) == 'ws://') {
      opts.browserWSEndpoint = browserAddress;
  } else {
      opts.browserURL = browserAddress;
  }

  const browser = await puppeteer.connect(opts);
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.isInterceptResolutionHandled()) return;

    const url = req.url();
    if (url.endsWith('reviews.json')) {
       return req.respond({
          ok: true,
          status: 200,
          contentType: 'application/json',
          body: `["over 9000!"]`,
        });
    }

    if (url.endsWith('product.json')) {
       return req.abort();
    }

    req.continue();
  });
  // Navigate the page to a URL
  await page.goto(baseURL + '/campfire-commerce/');

  await page.waitForFunction(() => {
      const desc = document.querySelector('#product-description');
      return desc.textContent.length > 0;
  }, {timeout: 100}); // timeout 100ms

  // ensure the reviews are loaded.
  await page.waitForFunction(() => {
      const reviews = document.querySelectorAll('#product-reviews > div');
      return reviews.length > 0;
  }, {timeout: 100}); // timeout 100ms

  let res = {};

  res.desc = await page.evaluate(() => { return document.querySelector('#product-description').textContent; });
  res.reviews = await page.evaluate(() => {
    const r = document.querySelectorAll('#product-reviews > div > p');
    return Array.from(r).map((n) => n.textContent);
  });

  // assertions
  if (res.desc != 'xhr: aborted') {
    console.log(res);
    throw new Error("invalid product description");
  }

  if (res.reviews.length != 1 || res.reviews[0] != 'over 9000!') {
    console.log(res);
    throw new Error("invalid reviews");
  }

  await page.close();
  await context.close();
  await browser.disconnect();
})();
