// Copyright 2023-2025 Lightpanda (Selecy SAS)
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

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
  browserWSEndpoint: browserAddress,
});
// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await context.setCookie({name: 'hello', value: 'world', url: "http://127.0.0.1:1234/"});

await page.goto('http://127.0.0.1:1234/cookies/set', {waitUntil: 'load'});
await page.goto('http://127.0.0.1:1234/cookies/fetch.html', {waitUntil: 'load'});

const found_cookies = await context.cookies();
for (const cookie of found_cookies) {
  const { name, ...details } = cookie
  console.log(`Cookie: ${name} = ${JSON.stringify(details)}`);
}
if (found_cookies.length != 2) {
  throw new Error("Wrong number of cookies found");
}

// check the output from the srv POV.
const element = await page.$('pre');
const pre = await page.evaluate(el => el.textContent, element);
const obj = JSON.parse(pre);

assert.equal(obj[0].Name, "hello");
assert.equal(obj[0].Value, "world");
assert.equal(obj[1].Name, "lightpanda");
assert.equal(obj[1].Value, "browser");

await page.close();
await context.close();
await browser.disconnect();

