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

await page.goto('https://www.reddit.com/r/Zig/comments/1ke7bau/zig_has_great_potential_for_async', {waitUntil: 'networkidle0'});

let foundPost = false;
const postBodyText = await page.$eval('shreddit-post-text-body', el => el.textContent);
if (postBodyText.includes("The ideal async model, I believe, is runtime agnostic, and without function coloring. I think Zig might have what it takes to do this.")) {
    foundPost = true;
}

if (!foundPost) {
    console.error("Failed to find main post body");
    throw new Error("invalid results");
}


let foundComment = false;
const commentBodyText = await page.$eval('shreddit-comment [slot=comment]', el => el.textContent);
if (commentBodyText.includes("Async was already present in earlier versions of Zig")) {
    foundComment = true;
}

if (!foundComment) {
    console.error("Failed to find comment of post");
    throw new Error("invalid results");
}

await page.close();
await context.close();
await browser.close();
