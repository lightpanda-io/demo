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
await page.goto(baseURL + '/pointer_events.html', {waitUntil: 'load'});

assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('sat')).pointerEvents), 'none');

// Puppeteer clicks at the element's center regardless; with pointer-events:none
// the click lands on whatever is underneath, never on the control itself.
await page.click('#sat');
await page.click('#sun');
const clicks = await page.evaluate(() => window.clicks);
assert.strictEqual(clicks.length, 2);
assert.notStrictEqual(clicks[0], 'sat', 'click on a pointer-events:none control');
assert.strictEqual(clicks[1], 'sun');

await page.close();
await context.close();
await browser.disconnect();
