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

const url = 'http://127.0.0.1:1234/get/headers';

const browser = await connectBrowser();
const context = await browser.createBrowserContext();
const page = await context.newPage();

async function refererFor(options) {
    const resp = await page.goto(url, { waitUntil: 'load', ...options });
    const headers = await resp.json();
    return headers['Referer']?.[0];
}

// Without referrerPolicy, Chrome applies strict-origin-when-cross-origin.
assert.equal(await refererFor({ referer: 'http://ref.example/path?q=1' }), 'http://ref.example/');
assert.equal(await refererFor({ referer: 'http://127.0.0.1:1234/from?q=1' }), 'http://127.0.0.1:1234/from?q=1');
assert.equal(await refererFor({ referer: 'https://ref.example/path' }), undefined);

assert.equal(await refererFor({ referer: 'http://ref.example/path?q=1', referrerPolicy: 'unsafeUrl' }), 'http://ref.example/path?q=1');
assert.equal(await refererFor({ referer: 'http://ref.example/path', referrerPolicy: 'origin' }), 'http://ref.example/');
assert.equal(await refererFor({ referer: 'http://ref.example/path', referrerPolicy: 'noReferrer' }), undefined);

assert.equal(await refererFor({}), undefined);

await assert.rejects(
    page.goto(url, { referer: 'http://ref.example/', referrerPolicy: 'nope' }),
    /Invalid referrerPolicy/,
);

await page.close();
await context.close();
await browser.disconnect();
