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
'use strict';

import puppeteer from 'puppeteer-core';

const BROWSER_ADDRESS = process.env.BROWSER_ADDRESS ?? 'ws://127.0.0.1:9222';
const QUERY = 'sodium';
const MOD = 'Sodium Extra';

const browser = await puppeteer.connect({
  browserWSEndpoint: BROWSER_ADDRESS,
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

const cleanup = async () => {
  await page.close();
  await context.close();
  await browser.disconnect();
};

// Modrinth renders everything client-side and swaps the DOM out from under us
// during navigation, which makes element handles go stale. Poll by re-running
// the query in the page on every tick instead of holding on to a handle.
const poll = async (fn, arg, { timeout = 30_000, interval = 300 } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
};

// 1. Navigate to the index page and make sure the search box is present.
await page.goto('https://modrinth.com/', {
  waitUntil: 'load',
  timeout: 30_000,
});
const hasSearch = await poll(() => !!document.querySelector('input#search'));
if (!hasSearch) {
  await cleanup();
  console.log('Failed to find the search box on the index page');
  throw new Error('invalid index page');
}

// 2. Search for a mod. Modrinth's home search box submits through its
// client-side router rather than a regular form, so we type the query to
// exercise the input and then open the results page for it.
await page.type('input#search', QUERY);

// Wait for the results to render, then read the name and creator of the card
// matching the mod we're looking for straight from the search results. The
// results sometimes fail to render, so reload once before giving up.
const findCard = (mod) => {
  for (const title of document.querySelectorAll('.project-card-title')) {
    if (title.textContent.trim() !== mod) continue;

    let card = title;
    for (let i = 0; i < 6 && card; i++) {
      if (card.querySelector?.('a[href^="/mod/"]')) break;
      card = card.parentElement;
    }
    if (!card) return null;

    const href = card.querySelector('a[href^="/mod/"]')?.getAttribute('href');
    const creator = card.querySelector('a[href^="/user/"]')?.textContent.trim();
    if (!href || !creator) return null;
    return { href, name: title.textContent.trim(), creator };
  }
  return null;
};

let result = null;
for (let attempt = 0; attempt < 2 && !result; attempt++) {
  await page.goto(`https://modrinth.com/mods?q=${encodeURIComponent(QUERY)}`, {
    waitUntil: 'load',
    timeout: 30_000,
  });
  result = await poll(findCard, MOD);
}

if (!result) {
  await cleanup();
  console.log('Failed to find the mod in search results', MOD);
  throw new Error('invalid search results');
}

// 3. Navigate to the mod's page by following the link from the results (a cold
// load of the project page is not reliable), then read its name and creator.
// The first member listed on a project page is its owner/creator; the link
// text is the username followed by the role (e.g. "FlashyReeseOwner").
await page.evaluate((href) => {
  document.querySelector(`a[href="${href}"]`)?.click();
}, result.href);

const project = await poll((href) => {
  if (location.pathname !== href) return null;
  const name = document.querySelector('h1')?.textContent.trim();
  const creator = document.querySelector('a[href^="/user/"]')?.textContent.trim();
  if (!name || !creator) return null;
  return { name, creator };
}, result.href);

await cleanup();

if (!project) {
  console.log('Failed to load the mod page', result.href);
  throw new Error('invalid mod page');
}

// 4. Compare the name and creator from the results with the mod's page.
if (project.name !== result.name) {
  console.log('Mod name mismatch', { search: result.name, page: project.name });
  throw new Error('invalid mod name');
}

if (!project.creator.startsWith(result.creator)) {
  console.log('Mod creator mismatch', {
    search: result.creator,
    page: project.creator,
  });
  throw new Error('invalid mod creator');
}
