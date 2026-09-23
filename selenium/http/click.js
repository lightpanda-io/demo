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

// puppeteer/click.js over the HTTP session: a link click that navigates, one
// whose listener cancels it, and navigations started from a script. Stock W3C
// WebDriver only, so it runs unchanged against chromedriver or geckodriver
// (BROWSER=firefox).
import assert from 'node:assert/strict';
import { Builder, Browser, By, until } from 'selenium-webdriver';

// WebDriver server url.
const serverURL = process.env.WEBDRIVER_URL ? process.env.WEBDRIVER_URL : 'http://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234';

const browserName = process.env.BROWSER ? process.env.BROWSER : Browser.CHROME;

const home = baseURL + '/';
const target = baseURL + '/campfire-commerce/';
const link = By.css("a[href='campfire-commerce/']");

(async () => {
  const driver = await new Builder()
    .usingServer(serverURL)
    .forBrowser(browserName)
    .build();

  try {
    await driver.get(home);
    await driver.executeScript(() => {
      sessionStorage.removeItem('handled');
      document.querySelector("a[href='campfire-commerce/']").addEventListener('click', () => {
        // The listener should fire, but should not stop the navigate
        sessionStorage.setItem('handled', '1');
      });
    });

    // a click that navigates is answered once the new page has loaded
    await driver.findElement(link).click();
    assert.equal(await driver.getCurrentUrl(), target, 'The new page URL is not as expected.');
    assert.equal(await driver.executeScript(() => sessionStorage.getItem('handled')), '1', 'The click handler did not run.');

    // The price and reviews come from XHRs after load. WebDriver has nothing
    // like puppeteer's networkidle0, so wait for what the page shows.
    const price = await driver.wait(until.elementLocated(By.css('#product-price')), 4000);
    await driver.wait(async () => (await price.getText()) !== '', 4000);
    assert.equal(parseFloat((await price.getText()).substring(1)), 244.99, 'invalid product price');

    await driver.wait(async () => (await driver.findElements(By.css('#product-reviews > div'))).length > 0, 4000);
    const reviews = await driver.executeScript(() => {
      return Array.from(document.querySelectorAll('#product-reviews > div')).map(row => {
        return {
          name: row.querySelector('h4').textContent,
          text: row.querySelector('p').textContent,
        };
      });
    });
    assert.equal(reviews.length, 3, 'invalid reviews length');

    // A navigation a script starts isn't waited on: W3C doesn't make
    // executeScript wait for it, so poll the url.
    await driver.get(home);
    await driver.executeScript(() => document.querySelector("a[href='campfire-commerce/']").click());
    await driver.wait(until.urlIs(target), 4000, 'element.click() did not navigate.');

    await driver.get(home);
    await driver.executeScript(() => {
      // MouseEvent.click() triggers it too
      document.querySelector("a[href='campfire-commerce/']").dispatchEvent(
        new MouseEvent('click', {bubbles: true, cancelable: true}));
    });
    await driver.wait(until.urlIs(target), 4000, 'dispatchEvent(click) did not navigate.');

    await driver.get(home);
    await driver.executeScript(() => {
      window.handlerRan = 0;
      document.querySelector("a[href='campfire-commerce/']").addEventListener('click', (e) => {
        // preventDefault _should_ stop the navigate
        window.handlerRan += 1;
        e.preventDefault();
      });
    });
    await driver.findElement(link).click();
    await driver.sleep(500);
    assert.equal(await driver.getCurrentUrl(), home, 'preventDefault() did not suppress the navigation.');
    assert.equal(await driver.executeScript(() => window.handlerRan), 1, 'The preventDefault handler did not run.');
  } finally {
    await driver.quit();
  }
})();
