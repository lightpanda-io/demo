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

// deleteCookie re-sends the cookies from context.cookies() with an expiry in
// the past, so whatever getCookies reports has to be accepted back.
const url = 'http://127.0.0.1:1234/';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();

await context.setCookie(
  {name: 'host', value: 'v', url},
  {name: 'dom', value: 'v', domain: '.example.test'},
  {name: 'other', value: 'v', url},
);
assert.strictEqual((await context.cookies()).length, 3, 'three cookies are set');

const [host] = (await context.cookies()).filter((c) => c.name === 'host');
await context.deleteCookie(host);
await context.deleteMatchingCookies({name: 'dom'});
const left = (await context.cookies()).map((c) => c.name);
assert.deepStrictEqual(left, ['other'], 'deleteCookie and deleteMatchingCookies');

await context.close();
await browser.disconnect();
