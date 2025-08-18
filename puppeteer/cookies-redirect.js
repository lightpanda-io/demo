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

import puppeteer from 'puppeteer-core';
import assert from 'assert';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:9222',
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

await context.setCookie({name: 'manual', value: 'A', url: "https://httpbin.io/cookies", path:"/cookies"});

const response = await page.goto("https://httpbin.io/cookies/set?manual=B", {waitUntil: 'load'});

const cookies = await context.cookies();

// we expect having one cookie set with name `manual` and `B1 value.
assert.strictEqual(1, cookies.length, 'Exactly one cookie is set');
assert.strictEqual('manual', cookies[0].name, 'Cookie name is manual');
assert.strictEqual('B', cookies[0].value, 'Cookie value is B');

await page.close();
await context.close();
await browser.disconnect();
