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
const LOCATION = 'Tokyo';

const browser = await puppeteer.connect({
  browserWSEndpoint: BROWSER_ADDRESS,
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('https://www.airbnb.com/s/Tokyo/homes', {
  waitUntil: 'networkidle0',
  timeout: 30000,
});

const result = await page.evaluate(() => {
  const cards = Array.from(
    document.querySelectorAll('[data-testid="card-container"]'),
  );
  const listings = cards.map((card) => {
    const link = card.querySelector('a[href*="/rooms/"]');
    return {
      href: link?.getAttribute('href') ?? '',
      label: link?.getAttribute('aria-label') ?? '',
    };
  });
  return {
    title: document.title,
    listings,
  };
});

await page.close();
await context.close();
await browser.disconnect();

if (!result.title.includes(LOCATION)) {
  console.log('Unexpected page title', result.title);
  throw new Error('invalid page');
}

if (result.listings.length < 5) {
  console.log('Too few listings', result.listings.length);
  throw new Error('invalid results');
}

const withRoomLink = result.listings.filter((l) =>
  l.href.startsWith('/rooms/'),
);
if (withRoomLink.length < 5) {
  console.log('Too few /rooms/ links', withRoomLink.length);
  throw new Error('invalid results');
}
