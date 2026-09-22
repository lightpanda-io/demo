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

// Regression test for the HTTP WebDriver session, the counterpart to
// selenium/bidi/demo.js. Nothing here opens a websocket: every call below is
// stock W3C WebDriver over HTTP, so this script runs unchanged against
// chromedriver. Lightpanda needs `serve --protocol webdriver` -- the default
// is cdp only, and POST /session is a 404 without it.
//
// Endpoints not implemented yet are listed at the bottom; add them here as
// they land.
import assert from 'node:assert/strict';
import { Builder, Browser, By, until, error } from 'selenium-webdriver';

// WebDriver server url.
const serverURL = process.env.WEBDRIVER_URL ? process.env.WEBDRIVER_URL : 'http://127.0.0.1:9222';

// web page to load.
const url = process.env.URL ? process.env.URL : 'http://127.0.0.1:1234/campfire-commerce/';

(async () => {
  const driver = await new Builder()
    .usingServer(serverURL)
    .forBrowser(Browser.CHROME)
    .build();

  try {
    const session = await driver.getSession();
    assert.ok(session.getId(), 'session id');

    // == navigation and page ==
    await driver.get(url);
    assert.equal(await driver.getCurrentUrl(), url);
    assert.ok((await driver.getTitle()).length > 0, 'title');
    assert.match(await driver.getPageSource(), /<html/i);
    await driver.navigate().refresh();
    assert.equal(await driver.getCurrentUrl(), url, 'url survives a refresh');
    assert.ok((await driver.takeScreenshot()).length > 0, 'screenshot');

    // The page fills itself in from JS, so wait the way a real script would.
    await driver.wait(() => driver.executeScript(
      () => document.querySelectorAll('#product-reviews > div').length > 0,
    ), 2000, 'reviews not loaded', 10);

    // == finding elements ==
    // By.id/name/className are rewritten to css by the client, so css, xpath
    // and the three text strategies are the whole wire surface.
    const name = await driver.findElement(By.css('#product-name'));
    const ref = await name.getId();
    assert.equal(await (await driver.findElement(By.id('product-name'))).getId(), ref, 'the same node keeps its reference');
    assert.equal(await (await driver.findElement(By.xpath('//h1[@id="product-name"]'))).getId(), ref);
    assert.equal(await (await driver.findElement(By.tagName('h1'))).getId(), ref);
    assert.ok((await driver.findElements(By.css('a'))).length > 1, 'findElements');
    assert.equal((await driver.findElements(By.css('#nope'))).length, 0, 'findElements matching nothing');

    // scoped to an element rather than the document
    const related = await driver.findElement(By.css('#product-related'));
    const cards = await related.findElements(By.css('div'));
    assert.equal(cards.length, 3, 'related products');
    assert.ok(await (await related.findElement(By.css('h4'))).getText(), 'findElement from an element');

    assert.equal(await (await driver.switchTo().activeElement()).getTagName(), 'body', 'nothing is focused');

    // == reading an element ==
    assert.equal(await name.getTagName(), 'h1', 'tag names are lowercase');
    assert.ok((await name.getText()).length > 0, 'getText');
    assert.equal(await name.getAttribute('id'), 'product-name');
    assert.equal(await name.getAttribute('nope'), null, 'a missing attribute is null');
    assert.equal(await name.getProperty('tagName'), 'H1', 'a property is not an attribute');
    assert.equal(await name.getCssValue('display'), 'block');
    // Shape, not numbers: the pseudo layout gives everything without an
    // explicit dimension a 5x5 box, so a heading really is 5x5 here.
    assert.deepEqual(Object.keys(await name.getRect()).sort(), ['height', 'width', 'x', 'y']);
    assert.equal(await name.isEnabled(), true);
    assert.equal(await name.isSelected(), false);

    const qty = await driver.findElement(By.css('input[type=number]'));
    assert.equal(await qty.getAttribute('value'), '1');

    // isDisplayed has no W3C route: Selenium posts a 17KB atom to
    // /execute/sync, so this is really a body-size and clone test too.
    assert.equal(await name.isDisplayed(), true, 'isDisplayed atom');
    assert.equal(await driver.executeScript(() => {
      const hidden = document.createElement('p');
      hidden.style.display = 'none';
      document.body.appendChild(hidden);
      return hidden;
    }).then((el) => el.isDisplayed()), false, 'isDisplayed on a hidden element');

    // == executing script ==
    // The script is a function body with `arguments` bound; Selenium wraps a
    // function as "return (fn).apply(null, arguments)".
    assert.equal(await driver.executeScript('return 1 + 1;'), 2);
    assert.equal(await driver.executeScript((a, b) => a + b, 'x', 'y'), 'xy');
    assert.equal(await driver.executeScript(() => undefined), null, 'undefined is null');
    assert.equal(await driver.executeScript(() => 0 / 0), null, 'JSON has no NaN');
    assert.deepEqual(await driver.executeScript(() => ({ a: 1, b: [true, null, 'x'] })), { a: 1, b: [true, null, 'x'] });
    assert.equal(await driver.executeScript(() => new Date(0)), '1970-01-01T00:00:00.000Z', 'toJSON wins');

    // an element out of a script, and back into one
    const fromScript = await driver.executeScript(() => document.querySelector('#product-name'));
    assert.equal(await fromScript.getId(), ref, 'a script hands back the same reference');
    assert.equal(await driver.executeScript((el) => el.id, name), 'product-name');
    assert.equal((await driver.executeScript(() => document.querySelectorAll('#product-related > div'))).length, 3, 'a NodeList is an array');

    // a promise is resolved before the command answers
    assert.equal(await driver.executeScript(() => Promise.resolve(7)), 7);
    assert.equal(await driver.executeAsyncScript('arguments[0](42);'), 42);
    assert.equal(await driver.executeAsyncScript(
      'var cb = arguments[arguments.length - 1]; setTimeout(function() { cb("late"); }, 10);',
    ), 'late');

    // == timeouts ==
    assert.deepEqual(await driver.manage().getTimeouts(), { script: 30000, pageLoad: 300000, implicit: 0 });
    await driver.manage().setTimeouts({ script: 100 });
    assert.equal((await driver.manage().getTimeouts()).script, 100, 'a partial update leaves the rest alone');
    await assert.rejects(
      () => driver.executeAsyncScript('// never calls back'),
      error.ScriptTimeoutError,
      'a script that never completes times out',
    );
    // Resolving after the timeout already answered. The pending command has
    // to outlive its own answer -- answering is not the promise settling, and
    // V8 still holds our callbacks on a live promise -- so freeing it on the
    // timeout segfaults the worker when this resolve lands.
    await assert.rejects(
      () => driver.executeAsyncScript('var cb = arguments[0]; setTimeout(function() { window.__late = true; cb("way late"); }, 150);'),
      error.ScriptTimeoutError,
    );
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await driver.executeScript('return window.__late === true;'), true, 'the late resolve really ran');
    assert.equal(await driver.executeScript('return "alive";'), 'alive', 'and the session survived it');

    await driver.manage().setTimeouts({ script: 30000 });

    // == input ==
    await driver.actions().move({ origin: name }).click().perform();
    await driver.actions().clear();

    // == waits, which are built on the above ==
    await driver.wait(until.elementLocated(By.css('#product-price')), 2000);
    await driver.wait(until.elementIsVisible(name), 2000);

    // == errors ==
    await assert.rejects(() => driver.findElement(By.css('#nope')), error.NoSuchElementError);
    await assert.rejects(() => driver.findElement(By.css('[')), error.InvalidSelectorError);
    await assert.rejects(() => driver.executeScript('throw new Error("boom");'), error.JavascriptError);
    await assert.rejects(() => driver.executeScript('return ('), error.JavascriptError, 'a syntax error');
    await assert.rejects(() => driver.executeScript(() => { const a = {}; a.self = a; return a; }),
      error.JavascriptError, 'a cycle cannot be cloned');

    // a reference to a node that has left the document
    const doomed = await driver.executeScript(() => {
      const p = document.createElement('p');
      document.body.appendChild(p);
      return p;
    });
    await driver.executeScript((el) => el.remove(), doomed);
    await assert.rejects(() => doomed.getText(), error.StaleElementReferenceError);

    // ids are dropped on navigation
    await driver.get(url);
    await assert.rejects(() => name.getText(), error.WebDriverError, 'a reference does not survive a navigation');

    console.log('selenium/http/demo.js: ok');
  } finally {
    await driver.quit();
  }
})();

// Not implemented yet, so deliberately untested here:
//   POST   /session/{id}/element/{id}/click
//   POST   /session/{id}/element/{id}/value    (sendKeys)
//   POST   /session/{id}/element/{id}/clear
//   POST   /session/{id}/back, /forward
//   GET    /session/{id}/cookie, POST, DELETE
//   POST   /session/{id}/window/new, GET+POST /window/rect
//   POST   /session/{id}/frame, /frame/parent
// The implicit and pageLoad timeouts round-trip but aren't enforced.
