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
const baseURL = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234'

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await testForm(page, '/form/get.html', {
  method: 'GET',
  body: '',
  query: 'h1=v1&h3=v3hello&favorite+drink=tea&ta=OVER+9000%21',
}, async() => {
  await page.type('#input', 'hello');
  await page.type('#ta', 'OVER 9000!');
  await page.focus('#input');
  await page.keyboard.press('Enter');
});

await testForm(page, '/form/post.html', {
  method: 'POST',
  body: 'h1=v1&h3=v3&favorite+drink=tea',
  query: '',
});

await testForm(page, '/form/submit_button.html', {
  method: 'POST',
  body: 'h1=v1&h3=v3&favorite+drink=tea&s1=go',
  query: '',
}, async () => {
  await page.click("[name=s1]");
});

await testForm(page, '/form/input_button.html', {
  method: 'POST',
  body: 'h1=v1&h3=v3&favorite+drink=tea&b1=b1v',
  query: '',
}, async () => {
  await page.click("[name=b2]"); // disabled, should do nothing
  await page.click("[name=b3]"); // not submit
  await page.click("[name=b1]");
});

await context.close();
await browser.disconnect();

async function testForm(page, url, expected, onLoad) {
  await page.goto(baseURL + url);

  if (onLoad) {
    await onLoad();
  }

  await page.waitForFunction(() => {
      const p = document.querySelector('#method');
      return p.textContent != '';
  }, {timeout: 4000});

  const method = await page.evaluate(() => { return document.querySelector('#method').textContent; });
  if (method !== expected.method) {
    console.log(method);
    throw new Error("invalid method");
  }

  const body = await page.evaluate(() => { return document.querySelector('#body').textContent; });
  if (body !== expected.body) {
    console.log(body);
    throw new Error("invalid body");
  }

  const query = await page.evaluate(() => { return document.querySelector('#query').textContent; });
  if (query !== expected.query) {
    console.log(query);
    throw new Error("invalid query");
  }
}
