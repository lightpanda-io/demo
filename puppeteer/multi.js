// Copyright 2023-2024 Lightpanda (Selecy SAS)
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
'use scrict'

import puppeteer from 'puppeteer-core'

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/form/get.html';

// First of all, create multiple connections at the same time
const browsers = await Promise.all(Array.from(new Array(10)).map(() => {
  return puppeteer.connect({ browserWSEndpoint: browserAddress });
}));

// For each connection, create a context
const contexts = await Promise.all(browsers.map(it => it.createBrowserContext()));

// Create one page, implement navigation and get content
const pages = await Promise.all(contexts.map(async (context, i) => {
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 4000 });
  const html = await page.content();

  if (html.includes('favorite drink')) {
    console.log(`Page ${i} loaded!`);
  } else {
    console.log(html);
    throw new Error("invalid HTML content");
  }

  return page;
}));

// Once all pages are received, close them all.
await Promise.all(pages.map(it => it.close()));
await Promise.all(contexts.map(it => it.close()));
await Promise.all(browsers.map(it => it.disconnect()));
