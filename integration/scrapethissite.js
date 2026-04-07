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
import { connect } from "puppeteer-core";

const browser = await connect({ browserWSEndpoint: "ws://127.0.0.1:9222" });

const context = await browser.createBrowserContext();
const page = await context.newPage();

await page.goto("https://www.scrapethissite.com/", { timeout: 60_000, waitUntil: "domcontentloaded" });

// Click the primary button, then wait for navigation or DOM to settle
const selector = ".btn.btn-lg.btn-primary";
await page.waitForSelector(selector, { timeout: 15000 });

// Try to detect navigation or at least network/DOM idle after click
const maybeNavigated = page
.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 })
.catch(() => null);
await page.click(selector);
await maybeNavigated;

// Return the full HTML
await page.evaluate(() => document.documentElement.outerHTML);

const title = await page.evaluate(() => {
  return document.title;
});
if (!title.includes("Sign Up | Scrape This Site | A public sandbox for learning web scraping")) {
    console.error("Failed to check title", title);
    throw new Error("invalid results");
}

await page.close();
await context.close();
await browser.disconnect();

