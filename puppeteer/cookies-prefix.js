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

import assert from 'assert';
import { connectBrowser } from './helpers.js'

// Cookie-name prefixes, as Chrome enforces them for cookies set over CDP and
// through document.cookie. __Secure- needs Secure, __Http- also HttpOnly,
// __Host- also Path=/ and no Domain, __Host-Http- both.
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:1234';
const https = 'https://example.test/';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();

const refused = {
  '__Host- with a Domain': {name: '__host-a', url: https, domain: '.example.test'},
  'a nameless cookie hiding a prefix': {name: '', value: ' __Host-x', url: https},
};
for (const [what, cookie] of Object.entries(refused)) {
  await assert.rejects(context.setCookie({value: 'v', ...cookie}), `refuses ${what}`);
}

await context.setCookie(
  {name: '__Host-a', value: 'v', url: https},
  {name: '__Host-Http-b', value: 'v', url: https, httpOnly: true},
);
const stored = (await context.cookies()).map((c) => c.name).sort();
assert.deepStrictEqual(stored, ['__Host-Http-b', '__Host-a'], 'valid prefixed cookies are kept');

// Script can't set HttpOnly, so document.cookie can never set __Http-.
// 127.0.0.1 is a potentially trustworthy origin: __Secure- works there.
const page = await context.newPage();
await page.goto(baseURL + '/ua.html', {waitUntil: 'load'});
const cookies = await page.evaluate(() => {
  document.cookie = '__Http-c=1; Secure';
  document.cookie = '__Secure-e=1; Secure';
  return document.cookie;
});
assert.strictEqual(cookies, '__Secure-e=1', 'document.cookie');

await page.close();
await context.close();
await browser.disconnect();
