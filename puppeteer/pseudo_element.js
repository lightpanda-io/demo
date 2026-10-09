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

import assert from 'assert';
import { connectBrowser } from './helpers.js'

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:1234';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.goto(baseURL + '/pseudo_element.html', {waitUntil: 'load'});

assert.deepStrictEqual(await page.evaluate(() => ({done: window.done, matched: window.matched})), {
  done: true,
  matched: ['.card'],
});

assert.strictEqual(await page.$('.card::after'), null);
assert.strictEqual((await page.$$('div::before')).length, 0);

await page.close();
await context.close();
await browser.disconnect();
