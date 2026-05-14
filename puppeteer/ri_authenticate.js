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

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';


(async () => {
  const browser = await connectBrowser();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  await page.setRequestInterception(true);

  page.on('request', (request) => {
    const credentials = Buffer.from('lpd:lpd').toString('base64');

    request.continue({
      headers: {
        ...request.headers(),
        'Authorization': `Basic ${credentials}`,
      },
    });
  });

  // Navigate the page to a URL
  await page.goto(baseURL + '/auth');

  const res = await page.evaluate(() => { return document.querySelector('body').textContent; });
  if (res != 'Hello') {
    console.log(res);
    throw new Error("invalid auth result");
  }

  await page.close();
  await context.close();
  await browser.disconnect();
})();
