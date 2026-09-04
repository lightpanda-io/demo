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

// LP.dump with strip mode "clutter". Three pages, one per tier:
// teasers.html has enough prose to clear the selection floor, so the
// scoring pass runs and drops teaser grids and share bars that no markup
// rule could; article.html sits under the floor, so selection falls back
// to the markup tier, which drops nav, aside, dialog and page-level
// header/footer but keeps the article's own header; navonly.html has all
// its text in the chrome, so that tier undoes itself and nothing is lost.

import puppeteer from 'puppeteer-core';
import { connectBrowser } from './helpers.js'

const base = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234';
const browser = await connectBrowser();

const context = await browser.createBrowserContext();
const page = await context.newPage();
const client = page._client();

function expect(cond, message, content) {
  if (!cond) {
    console.log(content);
    throw new Error(message);
  }
}

await page.goto(base + '/strip/article.html', { waitUntil: 'networkidle0' });

// Without strip: chrome and content are both there.
let res = await client.send('LP.dump', { format: 'markdown' });
expect(res.format === 'markdown', 'format echo', res);
expect(res.content.includes('News'), 'nav missing without strip', res.content);
expect(res.content.includes('First paragraph'), 'article missing without strip', res.content);

// clutter, markup tier: chrome gone, article header kept.
res = await client.send('LP.dump', { format: 'markdown', strip: { clutter: true } });
for (const gone of ['Site name', 'News', 'Related', 'Accept cookies', 'Copyright']) {
  expect(!res.content.includes(gone), `"${gone}" survived clutter strip`, res.content);
}
for (const kept of ['Headline', 'By someone', 'First paragraph', 'Second paragraph']) {
  expect(res.content.includes(kept), `"${kept}" lost to clutter strip`, res.content);
}

// Same flags, html format, scoped to a selector. Under the floor the
// selector's element is the root.
res = await client.send('LP.dump', { format: 'html', selector: 'main', strip: { clutter: true } });
expect(res.content.startsWith('<main>'), 'selector scoping', res.content);
expect(res.content.includes('<header><h1>Headline</h1>'), 'article header kept in html', res.content);

// png and pdf accept the same options and return base64.
res = await client.send('LP.dump', { format: 'png', strip: { clutter: true } });
expect(res.content.startsWith('iVBOR'), 'png base64', res.content.slice(0, 40));
res = await client.send('LP.dump', { format: 'pdf', strip: { clutter: true } });
expect(res.content.startsWith('JVBER'), 'pdf base64', res.content.slice(0, 40));

// The deprecated alias still answers.
res = await client.send('LP.getMarkdown', {});
expect(res.markdown.includes('First paragraph'), 'getMarkdown alias', res);

// A page whose text is all chrome: the strip is undone, nothing is lost.
await page.goto(base + '/strip/navonly.html', { waitUntil: 'networkidle0' });
res = await client.send('LP.dump', { format: 'markdown', strip: { clutter: true } });
expect(res.content.includes('Everything on this page'), 'clutter strip not undone', res.content);

// Enough prose for the scoring pass: teaser grids and the share bar sit in
// plain divs, so only selection can remove them.
await page.goto(base + '/strip/teasers.html', { waitUntil: 'networkidle0' });
res = await client.send('LP.dump', { format: 'markdown' });
expect(res.content.includes('Trending now'), 'teasers missing without strip', res.content);

res = await client.send('LP.dump', { format: 'markdown', strip: { clutter: true } });
for (const gone of ['Site name', 'Ten things', 'Trending now', 'Share on', 'Email this', 'bread knives']) {
  expect(!res.content.includes(gone), `"${gone}" survived clutter selection`, res.content);
}
for (const kept of ['Headline', 'First paragraph', 'Second paragraph', 'Third paragraph']) {
  expect(res.content.includes(kept), `"${kept}" lost to clutter selection`, res.content);
}

// html keeps its document shape: selection prunes beside the story rather
// than moving the root, so the doctype and body survive around it.
res = await client.send('LP.dump', { format: 'html', strip: { clutter: true } });
expect(res.content.startsWith('<!DOCTYPE html>'), 'document shape kept', res.content.slice(0, 80));
expect(res.content.includes('<div class="story">'), 'story kept in html', res.content);
for (const gone of ['class="topbar"', 'class="grid"', 'class="share"', 'class="more"']) {
  expect(!res.content.includes(gone), `${gone} survived in html`, res.content);
}

await page.close();
await context.close();
await browser.disconnect();
