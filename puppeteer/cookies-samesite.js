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
import assert from 'assert';
import { connectBrowser } from './helpers.js'

// SameSite enforcement on requests to 127.0.0.1. localhost reaches the same
// server but is a different host, so a page served from it is cross-site.
const site = 'http://127.0.0.1:1234';
const crossSite = 'http://localhost:1234';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();

// One cookie per SameSite mode: default (no attribute), Lax and Strict.
await page.goto(site + '/cookies/samesite/set', {waitUntil: 'load'});
assert.strictEqual((await context.cookies()).length, 3, 'three cookies are set');

// A cross-site iframe is a navigation, but not a top-level one: the Lax
// exception doesn't apply, no cookie is sent.
await page.goto(crossSite + '/cookies/samesite.html', {waitUntil: 'load'});
const frame = page.frames().find((f) => f !== page.mainFrame());
assert.ok(frame, 'the iframe is loaded');
assert.deepStrictEqual(await received(frame), [], 'cross-site iframe');

// A cross-site GET form submission is a top-level navigation with a safe
// method: Lax cookies ride along, Strict ones stay home.
await submit(crossSite, '#get_submit');
assert.deepStrictEqual(await received(page), ['default', 'lax'], 'cross-site GET');

// A cross-site POST is an unsafe method, so an explicit SameSite=Lax cookie
// is not sent. The cookie with no SameSite attribute was created seconds
// ago, so "Lax-allowing-unsafe" (RFC 6265bis 5.6.7.2) still lets it through.
await submit(crossSite, '#post_submit');
assert.deepStrictEqual(await received(page), ['default'], 'cross-site POST');

// Same-site: SameSite doesn't apply, even to a POST.
await submit(site, '#post_submit');
assert.deepStrictEqual(await received(page), ['default', 'lax', 'strict'], 'same-site POST');

await page.close();
await context.close();
await browser.disconnect();

// Loads the fixture from origin and submits one of its forms, both targeting
// 127.0.0.1/cookies/get.
async function submit(origin, selector) {
  await page.goto(origin + '/cookies/samesite.html', {waitUntil: 'load'});
  await Promise.all([
    page.waitForNavigation({waitUntil: 'load'}),
    page.click(selector),
  ]);
  assert.ok(page.url().startsWith(site + '/cookies/get'), 'the form submission navigated');
}

// The names of the cookies /cookies/get received, as echoed in its response.
async function received(target) {
  const pre = await target.evaluate(() => document.querySelector('pre').textContent);
  return JSON.parse(pre).map((c) => c.Name).sort();
}
