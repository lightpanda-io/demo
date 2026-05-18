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
const page = await browser.newPage();

await page.setRequestInterception(true);
let seen = 0, continued = 0;
page.on('request', (req) => {
  seen++;
  req.continue().then(() => { continued++; }).catch(() => {});
});

try {
  await page.goto('https://www.allbirds.com', { waitUntil: 'load', timeout: 20000 });
} catch (e) {
  throw new Error("timeout", e);
} finally {
  await page.close();
  await browser.close();
}

console.log('seen=' + seen + ' continued=' + continued);
if (seen != continued) {
  throw new Error("invalid seen and conitnued intercepted requests");
}
