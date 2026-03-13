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
'use strict'

import puppeteer from 'puppeteer-core';
import assert from 'assert';

const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:9222',
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

const response = await page.goto('http://127.0.0.1:1234/cookies/redirect', {waitUntil: 'load'});

const cookies = await context.cookies();

// we expect having one cookie set with name `redirect` and `B1 value.
assert.strictEqual(1, cookies.length, 'Exactly one cookie is set');
assert.strictEqual('redirect', cookies[0].name, 'Cookie name is redirect');
assert.strictEqual('cookie', cookies[0].value, 'Cookie value is cookie');

// check the httpbin output from the srv POV.
const element = await page.$('pre');
const pre = await page.evaluate(el => el.textContent, element);
const obj = JSON.parse(pre);
assert.equal(obj[0].Name, "redirect");
assert.equal(obj[0].Value, "cookie");

await page.close();
await context.close();
await browser.disconnect();
