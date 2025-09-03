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

const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'ws://127.0.0.1:9222';
const url = process.env.URL ? process.env.URL : 'https://wikipedia.com';

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
  browserWSEndpoint: browserAddress,
});

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto(url);

const html = await page.content();
if (html.substring(0, 20) !== "<!DOCTYPE html><html") {
  console.log(html.substring(0, 20));
  throw new Error("html content is not as expected");
}


await page.close();
await context.close();
await browser.disconnect();
