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
const MOVIE = 'The Godfather';
const EXPECTED_STAR = 'Marlon Brando';

const browser = await puppeteer.connect({
  browserWSEndpoint: BROWSER_ADDRESS,
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('https://www.imdb.com/', { waitUntil: 'networkidle0' });

await page.waitForSelector('input[name="q"]', { timeout: 10000 });
await page.type('input[name="q"]', MOVIE);

await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle0' }),
  page.keyboard.press('Enter'),
]);

const results = await page.evaluate(() => {
  const items = Array.from(
    document.querySelectorAll('a.ipc-title-link-wrapper'),
  );
  return items.map((el) => ({
    title: el.textContent?.trim() ?? '(no title)',
    href: el.getAttribute('href') ?? '(no href)',
  }));
});

if (results.length === 0) {
  await page.close();
  await context.close();
  await browser.disconnect();
  console.log('Failed to find search results', results.length);
  throw new Error('invalid search results');
}

const match = results.find(
  (r) => r.title === MOVIE && r.href.startsWith('/title/'),
);
if (!match) {
  await page.close();
  await context.close();
  await browser.disconnect();
  console.log('Failed to find expected movie in results', results);
  throw new Error('invalid results');
}

const movieURL = new URL(match.href, 'https://www.imdb.com').toString();
await page.goto(movieURL, { waitUntil: 'networkidle0' });

const cast = await page.evaluate(() => {
  return Array.from(
    document.querySelectorAll('[data-testid="title-cast-item__actor"]'),
  ).map((el) => el.textContent?.trim() ?? '');
});

await page.close();
await context.close();
await browser.disconnect();

if (cast.length === 0) {
  console.log('Failed to find cast on movie page', movieURL);
  throw new Error('invalid cast');
}

if (!cast.includes(EXPECTED_STAR)) {
  console.log(`Failed to find expected star "${EXPECTED_STAR}" in cast`, cast);
  throw new Error('invalid star');
}
