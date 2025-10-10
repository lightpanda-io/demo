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
'use strict'

import puppeteer from 'puppeteer-core';

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/campfire-commerce/';

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
  browserWSEndpoint: browserAddress,
});
// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

const relevant_cookie = {name: 'left', value: 'right', url: "http://127.0.0.1:1234/"};
const irrelevant_cookie = {name: 'uo', value: 'down', url: "https://lightpanda.io/"};
await context.setCookie(relevant_cookie, irrelevant_cookie);

await page.goto(url, {waitUntil: 'load'});

const found_cookies = await context.cookies();
for (const cookie of found_cookies) {
  const { name, ...details } = cookie
  console.log(`Cookie: ${name} = ${JSON.stringify(details)}`);
}
if (found_cookies.length != 2) {
  throw new Error("Wrong number of cookies found");
}

context.deleteCookie(irrelevant_cookie);
const found_cookies2 = await context.cookies();
if (found_cookies2.length != 1 && found_cookies2[0].name !== relevant_cookie.name || found_cookies2[0].value !== relevant_cookie.value) {
  throw new Error("Cookie does not match the expected values");
}

await page.close();
await context.close();
await browser.disconnect();
