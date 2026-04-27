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

for (let i = 0; i < 3; i++) {
  await (async () => {
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

    const intercepts = {index: 0, script: 0}

    page.on('request', req => {
      if (req.isInterceptResolutionHandled()) return;

      const url = req.url();
      if (url.endsWith('script1.js')) {
        intercepts.script += 1;
      } else if (url.endsWith('index.html')) {
        intercepts.index += 1;
      }
      req.continue();
    });

    // Navigate the page to a URL
    await page.goto(baseURL + '/caching/index.html');

    await page.waitForFunction(() => {
        return window.script1_load == 2;
    }, {timeout: 1000});

    await page.close();
    await context.close();
    await browser.disconnect();

    if (intercepts.script != 1) {
      console.log(`script1.js interception count: ${JSON.stringify(intercepts)}`);
      throw new Error('wrong request interception count for script1.js');
    }

    if (intercepts.index != 1) {
      console.log(`index.html request interception count: ${JSON.stringify(intercepts)}`);
      throw new Error('wrong request interception count for index.html');
    }
  })();
}
