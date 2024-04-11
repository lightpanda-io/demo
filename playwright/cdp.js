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
import fs from 'fs';

// Import the Chromium browser into our scraper.
import { chromium } from 'playwright';

// check if browser path if a local path or an URL
let browserPath = process.env.BROWSER_PATH;
let networkPath;
if (browserPath) {

    // not local path
    if (!fs.existsSync(browserPath)) {
	if (!browserPath.startsWith("http://")) {
	    browserPath = "http://" + browserPath
	}
	const url = new URL(browserPath);
	networkPath = url.host;
    }
}

// options passed to the browser
let browserOptions = {};
if (!networkPath) {

    // chrome browser path
    if (browserPath) {
	browserOptions.executablePath = browserPath;
    }

    // headless
    if (process.env.HEADLESS) {
	browserOptions.headless = process.env.HEADLESS === 'true';
    }
}

// web serveur url
const baseURL = process.env.BASE_URL ? process.env.BASE_URL : 'http://127.0.0.1:1234';

// runs
const runs = process.env.RUNS ? parseInt(process.env.RUNS) : 100;

// measure general time.
const gstart = process.hrtime.bigint();
// store all run durations
let metrics = [];

let browser;
if (networkPath) {

    // Connect to an existing browser
    console.log("Connection to browser on " + networkPath + "...");

    const resp = await fetch("http://" + networkPath + "/json/version");
    const version = await resp.json()
    const wsURL = version.webSocketDebuggerUrl;

    browser = await chromium.connectOverCDP(wsURL);

} else {

    // Launching a new browser
    if (browserPath) {
	console.log("Launching browser " + browserPath);
    } else {
	console.log("Launching browser");
    }
    
    // We use headless: false
    // to be able to watch the browser window.
    browser = await chromium.launch(browserOptions);

}

for (var run = 1; run<=runs; run++) {

    // measure run time.
    const rstart = process.hrtime.bigint();

    const context = await browser.newContext({
        baseURL: baseURL,
    });

    const page = await context.newPage();
    await page.goto('/campfire-commerce');

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

    res.name = await page.locator('#product-name').textContent();
    res.price = parseFloat((await page.locator('#product-price').textContent()).substring(1));
    res.description = await page.locator('#product-description').textContent();
    res.features = await page.locator('#product-features > li').allTextContents();
    res.image = await page.locator('#product-image').getAttribute('src');

    let related = [];
    var i = 0;
    for (const row of await page.locator('#product-related > div').all()) {
        related[i++] = {
            name: await row.locator('h4').textContent(),
            price: parseFloat((await row.locator('p').textContent()).substring(1)),
            image: await row.locator('img').getAttribute('src'),
        };
    }
    res.related = related;

    let reviews = [];
    var i =0;
    for (const row of await page.locator('#product-reviews > div').all()) {
        reviews[i++] = {
            title: await row.locator('h4').textContent(),
            text: await row.locator('p').textContent(),
        };
    }
    res.reviews = reviews;

    // console.log(res);

    process.stderr.write('.');
    if(run % 80 == 0) process.stderr.write('\n');

    await page.close();
    await context.close();

    metrics[run] = process.hrtime.bigint() - rstart;
}

// Turn off the browser to clean up after ourselves.
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

