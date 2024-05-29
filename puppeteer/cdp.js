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

// ws address
const browserAddress = process.env.BROWSER_ADDRESS ? process.env.BROWSER_ADDRESS : 'http://127.0.0.1:9222';

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

// runs
const runs = process.env.RUNS ? parseInt(process.env.RUNS) : 100;

const executablePath = process.env.CHROME_PATH;

// measure general time.
const gstart = process.hrtime.bigint();
// store all run durations
let metrics = [];

(async () => {
  // Launch the browser and open a new blank page
  const browser = await puppeteer.launch({
    executablePath: executablePath,
    browserURL: browserAddress,
  });

  for (var run = 1; run<=runs; run++) {
    // measure run time.
    const rstart = process.hrtime.bigint();

    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // Navigate the page to a URL
    await page.goto(baseURL + '/campfire-commerce');

    // ensure the price is loaded.
    await page.waitForFunction(() => {
        const price = document.querySelector('#product-price');
        return price.textContent.length > 0;
    });


    // ensure the reviews are loaded.
    await page.waitForFunction(() => {
        const reviews = document.querySelectorAll('#product-reviews > div');
        return reviews.length > 0;
    });

    let res = {};

    res.name = await page.evaluate(() => { return document.querySelector('#product-name').textContent; });
    res.price = parseFloat(await page.evaluate(() => { return document.querySelector('#product-price').textContent.substring(1); }));
    res.description = await page.evaluate(() => { return document.querySelector('#product-description').textContent; });
    res.features = await page.evaluate(() => { return document.querySelector('#product-features > li').allTextContents; });
    res.image = await page.evaluate(() => { return document.querySelector('#product-image').getAttribute('src'); });

    const related = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#product-related > div')).map(row => {
        return {
            name: row.querySelector('h4').textContent,
            price: parseFloat((row.querySelector('p').textContent).substring(1)),
            image: row.querySelector('img').getAttribute('src'),
        };
      });
    });
    res.related = related;

    const reviews = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#product-reviews > div')).map(row => {
        return {
            name: row.querySelector('h4').textContent,
            text: row.querySelector('p').textContent,
        };
      });
    });
    res.reviews = reviews;

    //console.log(res);

    process.stderr.write('.');
    if(run % 80 == 0) process.stderr.write('\n');

    await page.close();
    await context.close();

    metrics[run] = process.hrtime.bigint() - rstart;
  }

  await browser.close();

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
