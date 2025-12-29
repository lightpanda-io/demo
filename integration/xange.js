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

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
    browserWSEndpoint: browserAddress,
});

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto('https://www.xange.vc', {waitUntil: 'networkidle0'});

let valid = true;
const postBodyText = await page.$eval('section[data-slice-type="team"]', el => el.textContent);
if (!postBodyText.includes("Clementine Gazay") || !postBodyText.includes('Principal Paris')) {
    console.error("Failed to find 'Clementine Gazay'");
    valid = false;
}

if (!postBodyText.includes("Cyril Bertrand") || !postBodyText.includes('Managing Partner Paris')) {
    console.error("Failed to find 'Cyril Bertrand'");
    valid = false;
}

if (!postBodyText.includes("Nadja Bresous Mehigan") || !postBodyText.includes('Partner Impact Paris')) {
    console.error("Failed to find 'Nadja Bresous Mehigan'");
    valid = false;
}

if (!valid) {
    throw new Error("invalid results");
}

await page.close();
await context.close();
await browser.close();
