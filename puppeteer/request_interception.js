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

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

// The XHR event each abort error code gives, like Chrome: only 'aborted' is a
// cancel, any other code is a network error.
const cases = [
  { errorCode: 'aborted', desc: 'xhr: aborted' },
  { errorCode: 'failed', desc: 'xhr: error' },
  { errorCode: 'timedout', desc: 'xhr: timeout' },
];

(async () => {
  const browser = await connectBrowser();

  for (const { errorCode, desc } of cases) {
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
         return req.abort(errorCode);
      }

      req.continue();
    });
    // Navigate the page to a URL
    await page.goto(baseURL + '/campfire-commerce/');

    // The description reads 'Loading...' until the XHR settles.
    await page.waitForFunction(() => {
        const desc = document.querySelector('#product-description');
        return desc.textContent.startsWith('xhr: ');
    }, {timeout: 1000});

    // ensure the reviews are loaded.
    await page.waitForFunction(() => {
        const reviews = document.querySelectorAll('#product-reviews > div');
        return reviews.length > 0;
    }, {timeout: 1000});

    let res = {};

    res.desc = await page.evaluate(() => { return document.querySelector('#product-description').textContent; });
    res.reviews = await page.evaluate(() => {
      const r = document.querySelectorAll('#product-reviews > div > p');
      return Array.from(r).map((n) => n.textContent);
    });

    // assertions
    if (res.desc != desc) {
      console.log(errorCode, res);
      throw new Error(`invalid product description for ${errorCode}`);
    }

    if (res.reviews.length != 1 || res.reviews[0] != 'over 9000!') {
      console.log(errorCode, res);
      throw new Error("invalid reviews");
    }

    await page.close();
    await context.close();
  }

  await browser.disconnect();
})();
