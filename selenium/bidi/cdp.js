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

// Lightpanda serves WebDriver on http://127.0.0.1:9222 (`serve --protocol
// webdriver`). The driver is built the usual way, with Builder().usingServer()
// and BiDi enabled: pages are loaded over the HTTP session (driver.get), and
// everything else goes through the BiDi modules shipped in selenium-webdriver.
import { Builder, Browser, Capabilities } from 'selenium-webdriver';
import { Browser as BiDiBrowser } from 'selenium-webdriver/bidi/generated/browser.js';
import { BrowsingContext } from 'selenium-webdriver/bidi/generated/browsing_context.js';
import getScriptManager from 'selenium-webdriver/bidi/scriptManager.js';

// WebDriver server url.
const serverURL = process.env.WEBDRIVER_URL ? process.env.WEBDRIVER_URL : 'http://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

// Lightpanda answers to any browserName; a real driver does not, so let the
// caller name it: BROWSER=firefox runs this against geckodriver.
const browserName = process.env.BROWSER ? process.env.BROWSER : Browser.CHROME;

// runs
const runs = process.env.RUNS ? parseInt(process.env.RUNS) : 100;

// measure general time.
const gstart = process.hrtime.bigint();
// store all run durations
let metrics = [];

// Run `fn` in the page and return its result, like puppeteer's
// page.evaluate. Selenium's ScriptManager deserializes BiDi RemoteValues
// only one level deep (nested values stay wrapped), so instead of decoding
// them we stringify the result in the page and parse the plain string here.
async function evaluate(manager, context, fn) {
  const res = await manager.callFunctionInBrowsingContext(
    context,
    `() => JSON.stringify((${fn.toString()})())`,
    true, // awaitPromise
  );
  if (res.resultType !== 'success') {
    throw new Error('evaluate failed: ' + res.exceptionDetails.text);
  }
  // JSON.stringify(undefined) returns no value at all.
  return res.result.value === undefined ? undefined : JSON.parse(res.result.value);
}

(async () => {
  // browserName and webSocketUrl are plain W3C capabilities -- going through
  // them rather than chrome.Options keeps this driver-agnostic, so
  // BROWSER=firefox runs it against geckodriver unchanged.
  const capabilities = new Capabilities();
  capabilities.setBrowserName(browserName);
  capabilities.set('webSocketUrl', true);

  const driver = await new Builder()
    .usingServer(serverURL)
    .withCapabilities(capabilities)
    .build();

  const bidi = await driver.getBidi();
  await bidi.waitForConnection();

  const browser = await BiDiBrowser.create(driver);
  const browsingContext = await BrowsingContext.create(driver);
  const script = await getScriptManager(null, driver);

  for (var run = 0; run<runs; run++) {
    // measure run time.
    const rstart = process.hrtime.bigint();

    // A user context is the BiDi name for an isolated browser context.
    const { userContext } = await browser.createUserContext({});
    const { context } = await browsingContext.create({ type: 'tab', userContext });

    // Navigate the page to a URL, waiting for it to load.
    await driver.get(baseURL + '/campfire-commerce/');

    // ensure the price is loaded.
    await driver.wait(() => evaluate(script, context, () => {
        const price = document.querySelector('#product-price');
        return price.textContent.length > 0;
    }), 100, 'price not loaded', 10); // timeout 100ms, poll every 10ms

    // ensure the reviews are loaded.
    await driver.wait(() => evaluate(script, context, () => {
        const reviews = document.querySelectorAll('#product-reviews > div');
        return reviews.length > 0;
    }), 100, 'reviews not loaded', 10); // timeout 100ms, poll every 10ms

    let res = {};

    res.name = await evaluate(script, context, () => { return document.querySelector('#product-name').textContent; });
    res.price = parseFloat(await evaluate(script, context, () => { return document.querySelector('#product-price').textContent.substring(1); }));
    res.description = await evaluate(script, context, () => { return document.querySelector('#product-description').textContent; });
    res.image = await evaluate(script, context, () => { return document.querySelector('#product-image').getAttribute('src'); });

    const related = await evaluate(script, context, () => {
      return Array.from(document.querySelectorAll('#product-related > div')).map(row => {
        return {
            name: row.querySelector('h4').textContent,
            price: parseFloat((row.querySelector('p').textContent).substring(1)),
            image: row.querySelector('img').getAttribute('src'),
        };
      });
    });
    res.related = related;

    const reviews = await evaluate(script, context, () => {
      return Array.from(document.querySelectorAll('#product-reviews > div')).map(row => {
        return {
            name: row.querySelector('h4').textContent,
            text: row.querySelector('p').textContent,
        };
      });
    });
    res.reviews = reviews;

    //console.log(res);

    // assertions
    if (res['price'] != 244.99) {
      console.log(res);
      throw new Error("invalid product price");
    }
    if (res['image'] != "images/nomad_000.jpg") {
      console.log(res);
      throw new Error("invalid product image");
    }
    if (res['related'].length != 3) {
      console.log(res);
      throw new Error("invalid products related length");
    }
    if (res['reviews'].length != 3) {
      console.log(res);
      throw new Error("invalid reviews length");
    }

    process.stderr.write('.');
    if(run > 0 && run % 80 == 0) process.stderr.write('\n');

    await browsingContext.close({ context });
    await browser.removeUserContext({ userContext });

    metrics[run] = process.hrtime.bigint() - rstart;
  }

  await driver.quit();
  bidi.close();

  const gduration = process.hrtime.bigint() - gstart;

  process.stderr.write('\n');

  const avg = metrics.reduce((s, a) => s += a) / BigInt(metrics.length);
  const min = metrics.reduce((s, a) => a < s ? a : s);
  const max = metrics.reduce((s, a) => a > s ? a : s);

  console.log('total runs', runs);
  console.log('total duration (ms)', (gduration/1000000n).toString());
  console.log('avg run duration (ms)', (avg/1000000n).toString());
  console.log('min run duration (ms)', (min/1000000n).toString());
  console.log('max run duration (ms)', (max/1000000n).toString());
})();
