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

// replaceChildren adopts a node parsed by DOMParser, records one mutation
// for a node passed twice, and rejects a Document. Runs unchanged against
// Chrome.
import assert from 'assert';
import { chromium } from 'playwright-core';

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

const browser = await chromium.connectOverCDP(browserAddress);
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(baseURL + '/replace_children.html', { waitUntil: 'load' });

assert.deepStrictEqual(await page.evaluate(() => window.result), {
  adopted: true,
  records: 1,
  added: 1,
  removed: 1,
  scrollWidth: true,
  documentChild: 'HierarchyRequestError',
});
assert.deepStrictEqual(await page.locator('#list li').allTextContents(), ['one', 'two']);

const owner = await page.evaluate(() => {
  const other = document.implementation.createHTMLDocument('');
  const a = other.createElement('a');
  const b = other.createElement('b');
  document.body.replaceChildren(a, b);
  return [a.ownerDocument === document, b.ownerDocument === document, document.body.children.length];
});
assert.deepStrictEqual(owner, [true, true, 2]);

await context.close();
await browser.close();
