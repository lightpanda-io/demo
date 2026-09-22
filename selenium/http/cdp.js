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

// The same benchmark as selenium/bidi/cdp.js, over the HTTP session only: no
// websocket is ever opened. Everything here is stock W3C WebDriver --
// POST /session, POST /url, POST /execute/sync, DELETE /session -- so this
// script runs unchanged against chromedriver or geckodriver.
import { Builder, Browser } from 'selenium-webdriver';

// WebDriver server url.
const serverURL = process.env.WEBDRIVER_URL ? process.env.WEBDRIVER_URL : 'http://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

// runs
const runs = process.env.RUNS ? parseInt(process.env.RUNS) : 100;

// measure general time.
const gstart = process.hrtime.bigint();
// store all run durations
let metrics = [];

(async () => {
  for (var run = 0; run<runs; run++) {
    // measure run time.
    const rstart = process.hrtime.bigint();

    // A fresh session is the HTTP session's isolated browser context.
    const driver = await new Builder()
      .usingServer(serverURL)
      .forBrowser(Browser.CHROME)
      .build();

    // Navigate the page to a URL, waiting for it to load.
    await driver.get(baseURL + '/campfire-commerce/');

    // ensure the price is loaded.
    await driver.wait(() => driver.executeScript(() => {
        const price = document.querySelector('#product-price');
        return price.textContent.length > 0;
    }), 100, 'price not loaded', 10); // timeout 100ms, poll every 10ms

    // ensure the reviews are loaded.
    await driver.wait(() => driver.executeScript(() => {
        const reviews = document.querySelectorAll('#product-reviews > div');
        return reviews.length > 0;
    }), 100, 'reviews not loaded', 10); // timeout 100ms, poll every 10ms

    let res = {};

    res.name = await driver.executeScript(() => { return document.querySelector('#product-name').textContent; });
    res.price = parseFloat(await driver.executeScript(() => { return document.querySelector('#product-price').textContent.substring(1); }));
    res.description = await driver.executeScript(() => { return document.querySelector('#product-description').textContent; });
    res.image = await driver.executeScript(() => { return document.querySelector('#product-image').getAttribute('src'); });

    const related = await driver.executeScript(() => {
      return Array.from(document.querySelectorAll('#product-related > div')).map(row => {
        return {
            name: row.querySelector('h4').textContent,
            price: parseFloat((row.querySelector('p').textContent).substring(1)),
            image: row.querySelector('img').getAttribute('src'),
        };
      });
    });
    res.related = related;

    const reviews = await driver.executeScript(() => {
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

    await driver.quit();

    metrics[run] = process.hrtime.bigint() - rstart;
  }

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
