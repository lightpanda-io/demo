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

import puppeteer from 'puppeteer-core';

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview', {waitUntil: 'networkidle0', timeout: 30000});

const html = await page.content();

// Verify the page title rendered
const title = await page.evaluate(() => {
  const el = document.getElementById('page-title');
  return el ? el.textContent : null;
});

if (!title || !title.includes('Claude Code')) {
  console.log('Page title:', title);
  console.log(html.substring(0, 500));
  throw new Error('Page title not found or missing "Claude Code"');
}

// Verify key section headings rendered
const headings = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim());
});

for (const expected of ['Get started', 'What you can do', 'Next steps']) {
  if (!headings.some(h => h.includes(expected))) {
    console.log('Headings found:', headings);
    throw new Error(`Missing expected heading: "${expected}"`);
  }
}

// Verify sidebar navigation rendered
const sidebar = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[id="sidebar-title"]')).map(el => el.textContent.trim());
});

if (sidebar.length === 0) {
  throw new Error('Sidebar navigation not rendered');
}

await page.close();
await context.close();
await browser.disconnect();
