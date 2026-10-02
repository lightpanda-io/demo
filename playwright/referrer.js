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

import assert from 'assert';
import { chromium } from 'playwright-core';

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const url = 'http://127.0.0.1:1234/get/headers';

const browser = await chromium.connectOverCDP({ endpointURL: browserAddress });
const context = await browser.newContext();
const page = await context.newPage();

async function refererFor(options) {
  const resp = await page.goto(url, options);
  const headers = await resp.json();
  return headers['Referer']?.[0];
}

// Playwright sends referrerPolicy "unsafeUrl", so the full referrer goes
// out even cross-origin.
assert.equal(await refererFor({ referer: 'http://ref.example/path?q=1' }), 'http://ref.example/path?q=1');
assert.equal(await refererFor({ referer: 'http://127.0.0.1:1234/from?q=1' }), 'http://127.0.0.1:1234/from?q=1');
assert.equal(await refererFor({}), undefined);

await page.close();
await context.close();
await browser.close();
