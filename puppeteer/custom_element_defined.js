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

// Expectations recorded from headless Chrome; re-check with
// BROWSER_ADDRESS=http://127.0.0.1:9222.
'use strict'

import { connectBrowser } from './helpers.js'

const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/custom_element_defined.html';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto(url, { waitUntil: 'load', timeout: 10000 });

const failures = [];
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const visible = (selector) => page.$eval(selector, (e) => e.checkVisibility());

check('price hidden before load', await visible('#price'), false);
check('buy button hidden before load', await visible('#buy'), false);

await page.click('#load');

check('price shown after load', await visible('#price'), true);
check('buy button shown after load', await visible('#buy'), true);
check('buy button upgraded', await page.$eval('#buy', (e) => e.dataset.upgraded), 'yes');
check('detached badge upgrades on insert', await page.evaluate(() => window.log), ['connected:buy', 'badge:false', 'badge:true']);
check('badge shown', await visible('#badge'), true);

if (failures.length > 0) {
    console.log(`${failures.length} check(s) failed:`);
    for (const f of failures) console.log(`  ${f}`);
} else {
    console.log('all checks passed');
}

await page.close();
await context.close();
await browser.disconnect();
process.exit(failures.length > 0 ? 1 : 0);
