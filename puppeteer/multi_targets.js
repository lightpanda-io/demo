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

// Several pages (CDP targets) in one browser context, over one connection.
// Each page loads a different amiibo; the pages run at the same time.
'use strict'

import { connectBrowser } from './helpers.js'

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:1234';

// amiibo page => character name it displays once its JSON is loaded.
const amiibos = {
  '00000002': 'Mario',
  '00010002': 'Peach',
  '00020002': 'Yoshi',
  '00030002': 'Donkey Kong',
};

const browser = await connectBrowser();
const context = await browser.createBrowserContext();

const ids = Object.keys(amiibos);
const pages = await Promise.all(ids.map(() => context.newPage()));

// Each page only sees the requests of its own document.
const requests = pages.map(() => []);
pages.forEach((page, i) => page.on('request', (req) => requests[i].push(req.url())));

const names = await Promise.all(pages.map(async (page, i) => {
  await page.goto(`${baseURL}/amiibo/${ids[i]}.html`);
  // The name is set by the page's script once its JSON is fetched.
  await page.waitForFunction(() => document.getElementById('name').textContent !== 'Amiibo Character');
  return page.$eval('#name', (el) => el.textContent);
}));

ids.forEach((id, i) => {
  console.log(`page ${i}: ${names[i]}`);
  if (names[i] !== amiibos[id]) {
    throw new Error(`page ${i}: expected ${amiibos[id]}, got ${names[i]}`);
  }
  if (!requests[i].some((url) => url.endsWith(`/amiibo/${id}.json`))) {
    throw new Error(`page ${i}: missing its JSON request`);
  }
  if (requests[i].some((url) => url.endsWith('.json') && !url.endsWith(`/amiibo/${id}.json`))) {
    throw new Error(`page ${i}: got another page's request`);
  }
});

// Closing a page leaves the others running.
await pages[0].close();
const titles = await Promise.all(pages.slice(1).map((page) => page.title()));
console.log('after closing page 0:', titles);
if (titles.join() !== names.slice(1).join()) {
  throw new Error('a page changed when another one closed');
}

await context.close();
await browser.disconnect();
