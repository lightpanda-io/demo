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

// puppeteer/form.js over the HTTP session: typing, Enter in a field, and
// clicks on submit and non-submit buttons, each checked against what the
// server received. Stock W3C WebDriver only, so it runs unchanged against
// chromedriver or geckodriver (BROWSER=firefox).
import assert from 'node:assert/strict';
import { Builder, Browser, By, Key } from 'selenium-webdriver';

// WebDriver server url.
const serverURL = process.env.WEBDRIVER_URL ? process.env.WEBDRIVER_URL : 'http://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234';

const browserName = process.env.BROWSER ? process.env.BROWSER : Browser.CHROME;

(async () => {
  const driver = await new Builder()
    .usingServer(serverURL)
    .forBrowser(browserName)
    .build();

  try {
    // sendKeys focuses the field with the caret at the end, so h3 is v3hello.
    // puppeteer's page.type clicks the field first, which leaves the caret at
    // the start: hellov3 there.
    await testForm(driver, '/form/get.html', {
      method: 'GET',
      body: '',
      query: 'h1=v1&h3=v3hello&favorite+drink=tea&ta=OVER+9000%21',
    }, async () => {
      const input = driver.findElement(By.id('input'));
      await input.sendKeys('hello');
      await driver.findElement(By.id('ta')).sendKeys('OVER 9000!');
      await input.sendKeys(Key.ENTER);
    });

    await testForm(driver, '/form/post.html', {
      method: 'POST',
      body: 'h1=v1&h3=v3&favorite+drink=tea',
      query: '',
    });

    await testForm(driver, '/form/submit_button.html', {
      method: 'POST',
      body: 'h1=v1&h3=v3&favorite+drink=tea&s1=go',
      query: '',
    }, async () => {
      await driver.findElement(By.css('[name=s1]')).click();
    });

    await testForm(driver, '/form/input_button.html', {
      method: 'POST',
      body: 'h1=v1&h3=v3&favorite+drink=tea&b1=b1v',
      query: '',
    }, async () => {
      await driver.findElement(By.css('[name=b2]')).click(); // disabled, should do nothing
      await driver.findElement(By.css('[name=b3]')).click(); // not submit
      await driver.findElement(By.css('[name=b1]')).click();
    });

    await testForm(driver, '/form/onsubmit.html', {
      method: 'POST',
      body: 'field=updated',
      query: '',
    }, async () => {
      await driver.findElement(By.id('submit')).click();
    });

  } finally {
    await driver.quit();
  }
})();

async function testForm(driver, url, expected, onLoad) {
  await driver.get(baseURL + url);

  if (onLoad) {
    await onLoad();
  }

  // a page without an #method yet is still the form, not the result
  await driver.wait(() => driver.executeScript(() => {
    const p = document.querySelector('#method');
    return p != null && p.textContent != '';
  }), 4000);

  const text = (selector) => driver.executeScript((s) => document.querySelector(s).textContent, selector);
  assert.equal(await text('#method'), expected.method, 'invalid method');
  assert.equal(await text('#body'), expected.body, 'invalid body');
  assert.equal(await text('#query'), expected.query, 'invalid query');
}
