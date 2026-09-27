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
"use strict";

import puppeteer from "puppeteer-core";
//import { writeFileSync } from "node:fs";

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
  browserWSEndpoint: "ws://127.0.0.1:9222",
});

// The rest of your script remains the same.
const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto("https://readcomiconline.li/", {
  waitUntil: "networkidle0",
  timeout: 5_000,
});

await page.type("input[name=keyword]", "long halloween");
await page.keyboard.press("Enter");

await page.waitForNavigation({ waitUntil: "networkidle0" });

// Click on the first item.
await page.evaluate(() => {
  document.querySelector("div.col a").click();
});

await page.waitForNavigation({ waitUntil: "networkidle0" });

//writeFileSync("comics.html", await page.content());

await page.close();
await context.close();
await browser.disconnect();
