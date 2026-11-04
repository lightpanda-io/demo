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

// Runs unchanged against Chrome started with --enable-blink-features=WebMCP.
import assert from 'assert';
import { chromium } from 'playwright-core';

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

const browser = await chromium.connectOverCDP(browserAddress);
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(baseURL + '/webmcp/spec.html', { waitUntil: 'load' });
await page.evaluate(() => window.ready);

assert.deepStrictEqual(await page.evaluate(() => window.log), [
    'toolchange', 'registered:km_to_miles', 'toolchange', 'registered:wait_forever',
]);

const names = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name));
assert.deepStrictEqual(names, ['km_to_miles', 'wait_forever']);

const result = await page.evaluate(async () => {
    const [convert] = await document.modelContext.getTools();
    return document.modelContext.executeTool(convert, { km: 10 });
});
assert.strictEqual(result, '{"miles":6.21}');
assert.strictEqual(await page.textContent('#last'), '10 km = 6.21 mi');

await context.close();
await browser.close();
