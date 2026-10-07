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

import { connectBrowser } from './helpers.js'

// An iframe's document and the objects created through it belong to the
// iframe's realm, however the parent page reaches them. A listener the parent
// adds to an element created through iframe.contentDocument must fire.
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/frames/load/index.html';
const expected = {
  realms: { touched: 'child', untouched: 'child' },
  loads: ['touched', 'untouched'],
};

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = await page.createCDPSession();
try {
  await client.send('LP.configureLoading', { subFrame: true });
} catch {
  // not Lightpanda
}

await page.goto(url, { waitUntil: 'load' });

let got;
const deadline = Date.now() + 3000;
while (Date.now() < deadline) {
  got = await page.evaluate(() => ({ realms: window.realms, loads: [...window.loads].sort() }));
  if (got.loads.length >= expected.loads.length) break;
  await new Promise((r) => setTimeout(r, 50));
}

await page.close();
await context.close();
await browser.disconnect();

if (JSON.stringify(got) !== JSON.stringify(expected)) {
  throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}
