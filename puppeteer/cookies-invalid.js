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

// Cookies set over CDP go through the same checks as Chrome's
// CanonicalCookie::CreateSanitizedCookie: a name or value it would refuse
// makes the call fail instead of being stored.
const url = 'http://127.0.0.1:1234/';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();

const invalid = {
  'a ; in the name': {name: 'a;b', value: 'v'},
  'an = in the name': {name: 'a=b', value: 'v'},
  'a control char in the name': {name: 'a\u0001b', value: 'v'},
  'leading whitespace in the name': {name: ' a', value: 'v'},
  'a ; in the value': {name: 'a', value: 'x;y'},
  'a tab in the value': {name: 'a', value: 'x\ty'},
  'trailing whitespace in the value': {name: 'a', value: 'v '},
  'no name and no value': {name: '', value: ''},
};
for (const [what, cookie] of Object.entries(invalid)) {
  await assert.rejects(context.setCookie({...cookie, url}), `refuses ${what}`);
}
assert.deepStrictEqual(await context.cookies(), [], 'nothing was stored');

// Wider than RFC 6265bis's grammar, as in Chrome: non-ASCII and inner spaces.
await context.setCookie({name: 'a b', value: 'café', url});
const stored = (await context.cookies()).map((c) => [c.name, c.value]);
assert.deepStrictEqual(stored, [['a b', 'café']], 'non-ASCII and inner spaces are kept');

await context.close();
await browser.disconnect();
