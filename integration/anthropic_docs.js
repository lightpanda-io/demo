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

// Detect a real Cloudflare/captcha interstitial and exit with the dedicated
// captcha exit code (103). A genuine challenge replaces the whole document:
// the title becomes "Just a moment..." / "Attention Required!" AND the real
// page content (the #page-title heading) is absent. We require both signals so
// the always-present Turnstile <script> on the *successful* page is not
// mistaken for an interstitial.
const captcha = await page.evaluate(() => {
  const docTitle = document.title || '';
  const isChallengeTitle = /just a moment|attention required|checking your browser/i.test(docTitle);
  const hasRealContent = !!document.getElementById('page-title');
  return isChallengeTitle && !hasRealContent;
});

if (captcha) {
  console.log('Captcha / Cloudflare challenge detected, document.title:', await page.title());
  await page.close();
  await context.close();
  await browser.disconnect();
  process.exit(103);
}

// Verify the page rendered: the document title carries the product name
// ("Overview - Claude Code Docs") and the #page-title heading is present.
const titleInfo = await page.evaluate(() => {
  const el = document.getElementById('page-title');
  return { docTitle: document.title, pageTitle: el ? el.textContent.trim() : null };
});

if (!titleInfo.docTitle || !titleInfo.docTitle.includes('Claude Code')) {
  console.log('Document title:', titleInfo.docTitle);
  console.log(html.substring(0, 500));
  throw new Error('Document title not found or missing "Claude Code"');
}

if (!titleInfo.pageTitle) {
  throw new Error('Page title heading (#page-title) not rendered');
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

// Verify sidebar navigation rendered. The docs site exposes nav as <a> links
// under #navigation-items (formerly id="sidebar-title").
const sidebar = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('#navigation-items a')).map(el => el.textContent.trim());
});

if (sidebar.length === 0) {
  throw new Error('Sidebar navigation not rendered');
}

for (const expected of ['Overview', 'Quickstart']) {
  if (!sidebar.some(s => s.includes(expected))) {
    console.log('Sidebar links found:', sidebar.slice(0, 12));
    throw new Error(`Missing expected sidebar link: "${expected}"`);
  }
}

await page.close();
await context.close();
await browser.disconnect();
