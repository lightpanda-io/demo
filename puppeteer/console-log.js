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

const browser = await connectBrowser();

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

let log = false;
let err = false;
page.on('console', (evt) => {
  console.log("LOG", evt.type(), evt.text());
  if (evt.type() == "error") {
    err = true;
  }
  // TODO: remove '|| evt.type() == "info"'
  // This is only added since we have some PRs based on commits prior to
  // https://github.com/lightpanda-io/browser/pull/2731 which changed the type
  // from info to log
  if (evt.type() == "log" || evt.type() == "info") {
    log = true;
  }
});

await page.evaluate(() => {
  console.log('Hello from page');
  console.error('This is an error', 1, true);
});

await page.close();
await context.close();
await browser.disconnect();


if (log == false) {
  throw new Error("console log evt not catched");
}
if (err == false) {
  throw new Error("console error evt not catched");
}
