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

// Expectations recorded from headless Chrome started with
// --enable-blink-features=WebMCP; re-check with
// BROWSER_ADDRESS=http://127.0.0.1:9222.
'use strict'

import { connectBrowser } from './helpers.js'

const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/webmcp/spec.html';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto(url, { waitUntil: 'load', timeout: 10000 });
await page.evaluate(() => window.ready);

const failures = [];
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check('registration', await page.evaluate(() => window.log), [
    'toolchange', 'registered:km_to_miles', 'toolchange', 'registered:wait_forever',
]);

const tools = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => ({
    name: t.name,
    title: t.title,
    required: t.inputSchema?.required ?? null,
    readOnly: t.annotations?.readOnlyHint ?? null,
    sameWindow: t.window === window,
    origin: t.origin === location.origin,
})));
check('getTools', tools, [
    { name: 'km_to_miles', title: 'Kilometres to miles', required: ['km'], readOnly: true, sameWindow: true, origin: true },
    { name: 'wait_forever', title: '', required: null, readOnly: null, sameWindow: true, origin: true },
]);

const result = await page.evaluate(async () => {
    const [convert] = await document.modelContext.getTools();
    return document.modelContext.executeTool(convert, { km: 42.195 });
});
check('executeTool result', result, '{"miles":26.22}');
check('tool updated the page', await page.$eval('#last', (e) => e.textContent), '42.195 km = 26.22 mi');

const cancelled = await page.evaluate(async () => {
    window.log = [];
    const tools = await document.modelContext.getTools();
    const controller = new AbortController();
    const run = document.modelContext.executeTool(tools[1], {}, { signal: controller.signal });
    await new Promise((resolve) => document.modelContext.addEventListener('toolactivated', resolve, { once: true }));
    controller.abort('user changed their mind');
    const reason = await run.catch((e) => e);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { reason, log: window.log };
});
check('cancellation', cancelled, {
    reason: 'user changed their mind',
    log: ['activated:wait_forever', 'aborted:AbortError', 'cancel:wait_forever'],
});

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
