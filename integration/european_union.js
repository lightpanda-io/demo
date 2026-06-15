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

const browserAddress = process.env.BROWSER_ADDRESS
  ? process.env.BROWSER_ADDRESS
  : "ws://127.0.0.1:9222";

// use browserWSEndpoint to pass the Lightpanda's CDP server address.
const browser = await puppeteer.connect({
  browserWSEndpoint: browserAddress,
});

const context = await browser.createBrowserContext();
const page = await context.newPage();

// The root URL serves a language-selection gateway before the main site.
await page.goto("https://european-union.europa.eu", {
  waitUntil: "domcontentloaded",
  timeout: 30_000,
});

const title = await page.evaluate(() => document.title);

// Collect the hrefs of every link on the gateway so we can confirm the
// per-language entry points are present.
const links = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("a")).map((row) => {
    return row.getAttribute("href");
  });
});

await page.close();
await context.close();
await browser.disconnect();

if (!title.includes("Language selection | European Union")) {
  console.error("Failed to check title", title);
  throw new Error("invalid results");
}

const found = links.some(
  (href) => href && href.includes("european-union.europa.eu/index_en"),
);

if (!found) {
  console.error("Failed to find the English language link", links);
  throw new Error("invalid results");
}
